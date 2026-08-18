use napi_derive::napi;

#[napi]
pub mod leaderboard {
    use crate::api::localplayer::PlayerSteamId;
    use napi::bindgen_prelude::{BigInt, Error};
    use tokio::sync::oneshot;

    /// Maximum number of detail ints Steam stores per leaderboard entry.
    const MAX_DETAILS: usize = 64;

    /// Order Steam uses to rank scores (ELeaderboardSortMethod).
    #[napi]
    pub enum LeaderboardSortMethod {
        /// Lower scores rank higher, the usual choice for times.
        Ascending,
        /// Higher scores rank higher, the usual choice for points.
        Descending,
    }

    /// How the Steam UI formats a score (ELeaderboardDisplayType).
    #[napi]
    pub enum LeaderboardDisplayType {
        Numeric,
        TimeSeconds,
        TimeMilliSeconds,
    }

    /// What to do when the uploaded score is worse than the stored one
    /// (ELeaderboardUploadScoreMethod).
    #[napi]
    pub enum UploadScoreMethod {
        /// Keep the existing score if the new one does not beat it.
        KeepBest,
        /// Always replace the existing score.
        ForceUpdate,
    }

    /// Which slice of the leaderboard to download (ELeaderboardDataRequest).
    #[napi]
    pub enum LeaderboardDataRequest {
        /// Absolute ranks, 1 based.
        Global,
        /// Ranks relative to the local user's own rank.
        GlobalAroundUser,
        /// Only entries belonging to the user's friends.
        Friends,
    }

    #[napi(object)]
    pub struct LeaderboardEntry {
        pub user: PlayerSteamId,
        /// 1 based rank in the leaderboard.
        pub global_rank: i32,
        pub score: i32,
        /// Game defined payload stored with the score. Empty unless the entry
        /// was downloaded with a non-zero `maxDetails`.
        pub details: Vec<i32>,
    }

    #[napi(object)]
    pub struct LeaderboardScoreUploaded {
        /// The score Steam ended up storing.
        pub score: i32,
        /// Whether the stored score actually changed. False when `KeepBest`
        /// discarded the upload because the old score was better.
        pub was_changed: bool,
        pub global_rank_new: i32,
        pub global_rank_previous: i32,
    }

    /// A handle to a Steam leaderboard, returned by `findLeaderboard` or
    /// `findOrCreateLeaderboard`. Handles are only valid for the lifetime of
    /// the Steam session, so store the leaderboard name, not the id.
    #[napi]
    pub struct Leaderboard {
        /// Raw SteamLeaderboard_t handle. Diagnostic only.
        pub id: BigInt,
        handle: steamworks::Leaderboard,
    }

    #[napi]
    impl Leaderboard {
        /// The leaderboard name as configured on Steamworks. Empty string if
        /// the handle is invalid.
        #[napi]
        pub fn get_name(&self) -> String {
            let client = crate::client::get_client();
            client.user_stats().get_leaderboard_name(&self.handle)
        }

        /// Total number of entries in the leaderboard. 0 if the handle is
        /// invalid.
        #[napi]
        pub fn get_entry_count(&self) -> i32 {
            let client = crate::client::get_client();
            client
                .user_stats()
                .get_leaderboard_entry_count(&self.handle)
        }

        /// Null if the handle is invalid or Steam reports an unknown method.
        #[napi]
        pub fn get_sort_method(&self) -> Option<LeaderboardSortMethod> {
            let client = crate::client::get_client();
            client
                .user_stats()
                .get_leaderboard_sort_method(&self.handle)
                .map(|method| match method {
                    steamworks::LeaderboardSortMethod::Ascending => {
                        LeaderboardSortMethod::Ascending
                    }
                    steamworks::LeaderboardSortMethod::Descending => {
                        LeaderboardSortMethod::Descending
                    }
                })
        }

        /// Null if the handle is invalid or Steam reports an unknown type.
        #[napi]
        pub fn get_display_type(&self) -> Option<LeaderboardDisplayType> {
            let client = crate::client::get_client();
            client
                .user_stats()
                .get_leaderboard_display_type(&self.handle)
                .map(|display| match display {
                    steamworks::LeaderboardDisplayType::Numeric => LeaderboardDisplayType::Numeric,
                    steamworks::LeaderboardDisplayType::TimeSeconds => {
                        LeaderboardDisplayType::TimeSeconds
                    }
                    steamworks::LeaderboardDisplayType::TimeMilliSeconds => {
                        LeaderboardDisplayType::TimeMilliSeconds
                    }
                })
        }

        /// Upload a score for the local user.
        ///
        /// `details` is an optional game defined payload of at most 64 ints,
        /// stored alongside the score and returned by `downloadEntries` when a
        /// non-zero `maxDetails` is passed. Steam rate limits uploads to
        /// roughly 10 per 10 minutes per user.
        ///
        /// @returns the stored result, or null when Steam reported the upload
        /// as unsuccessful.
        #[napi]
        pub async fn upload_score(
            &self,
            method: UploadScoreMethod,
            score: i32,
            details: Option<Vec<i32>>,
        ) -> Result<Option<LeaderboardScoreUploaded>, Error> {
            let details = details.unwrap_or_default();
            if details.len() > MAX_DETAILS {
                return Err(Error::from_reason(format!(
                    "Leaderboard details may hold at most {MAX_DETAILS} ints, got {}",
                    details.len()
                )));
            }

            let method = match method {
                UploadScoreMethod::KeepBest => steamworks::UploadScoreMethod::KeepBest,
                UploadScoreMethod::ForceUpdate => steamworks::UploadScoreMethod::ForceUpdate,
            };

            let (tx, rx) = oneshot::channel();

            // Scoped so the non-Send UserStats handle is dropped before the await.
            {
                let client = crate::client::get_client();
                client.user_stats().upload_leaderboard_score(
                    &self.handle,
                    method,
                    score,
                    &details,
                    move |result| {
                        let _ = tx.send(result);
                    },
                );
            }

            rx.await
                .map_err(|_| Error::from_reason("Steam dropped the score upload callback"))?
                .map(|uploaded| {
                    uploaded.map(|u| LeaderboardScoreUploaded {
                        score: u.score,
                        was_changed: u.was_changed,
                        global_rank_new: u.global_rank_new,
                        global_rank_previous: u.global_rank_previous,
                    })
                })
                .map_err(|e| Error::from_reason(format!("{e:?}")))
        }

        /// Download a slice of the leaderboard.
        ///
        /// For `Global`, `start` and `end` are absolute 1 based ranks, so
        /// `1, 10` is the top ten. For `GlobalAroundUser` they are offsets
        /// relative to the local user's own rank and may be negative, so
        /// `-4, 5` is the user's row plus four above and five below. For
        /// `Friends` the range is ignored and Steam returns every friend.
        ///
        /// Steam returns at most 5000 entries per request.
        ///
        /// `maxDetails` is how many detail ints to read back per entry, at
        /// most 64. Defaults to 0, which skips details entirely.
        #[napi]
        pub async fn download_entries(
            &self,
            request: LeaderboardDataRequest,
            start: i32,
            end: i32,
            max_details: Option<u32>,
        ) -> Result<Vec<LeaderboardEntry>, Error> {
            let max_details = max_details.unwrap_or(0) as usize;
            if max_details > MAX_DETAILS {
                return Err(Error::from_reason(format!(
                    "maxDetails may be at most {MAX_DETAILS}, got {max_details}"
                )));
            }
            if start > end {
                return Err(Error::from_reason(format!(
                    "Leaderboard range start ({start}) must not be greater than end ({end})"
                )));
            }

            let request = match request {
                LeaderboardDataRequest::Global => steamworks::LeaderboardDataRequest::Global,
                LeaderboardDataRequest::GlobalAroundUser => {
                    steamworks::LeaderboardDataRequest::GlobalAroundUser
                }
                LeaderboardDataRequest::Friends => steamworks::LeaderboardDataRequest::Friends,
            };

            let (tx, rx) = oneshot::channel();

            // The crate takes the range as usize and casts it down to the
            // SDK's int, so a negative offset round-trips through the sign
            // extended cast below. That is the only way to express the
            // GlobalAroundUser range through this crate version.
            let (start, end) = (start as usize, end as usize);

            // Scoped so the non-Send UserStats handle is dropped before the await.
            {
                let client = crate::client::get_client();
                client.user_stats().download_leaderboard_entries(
                    &self.handle,
                    request,
                    start,
                    end,
                    max_details,
                    move |result| {
                        let _ = tx.send(result);
                    },
                );
            }

            rx.await
                .map_err(|_| Error::from_reason("Steam dropped the leaderboard download callback"))?
                .map(|entries| {
                    entries
                        .into_iter()
                        .map(|entry| LeaderboardEntry {
                            user: PlayerSteamId::from_steamid(entry.user),
                            global_rank: entry.global_rank,
                            score: entry.score,
                            details: entry.details,
                        })
                        .collect()
                })
                .map_err(|e| Error::from_reason(format!("{e:?}")))
        }
    }

    impl Leaderboard {
        fn from_handle(handle: steamworks::Leaderboard) -> Self {
            Self {
                id: BigInt::from(handle.raw()),
                handle,
            }
        }
    }

    /// Look up an existing leaderboard by its Steamworks name.
    /// @returns null when no leaderboard with that name exists.
    #[napi]
    pub async fn find_leaderboard(name: String) -> Result<Option<Leaderboard>, Error> {
        validate_name(&name)?;

        let (tx, rx) = oneshot::channel();

        // Scoped so the non-Send UserStats handle is dropped before the await.
        {
            let client = crate::client::get_client();
            client.user_stats().find_leaderboard(&name, move |result| {
                let _ = tx.send(result);
            });
        }

        finish_find(rx).await
    }

    /// Look up a leaderboard, creating it if it does not exist yet.
    ///
    /// Leaderboards created this way are owned by the app and are not visible
    /// in the Steamworks partner site until the app is published. The sort
    /// method and display type only apply when the leaderboard is created;
    /// an existing leaderboard keeps its configured values.
    /// @returns null when Steam neither found nor created the leaderboard.
    #[napi]
    pub async fn find_or_create_leaderboard(
        name: String,
        sort_method: LeaderboardSortMethod,
        display_type: LeaderboardDisplayType,
    ) -> Result<Option<Leaderboard>, Error> {
        validate_name(&name)?;

        let sort_method = match sort_method {
            LeaderboardSortMethod::Ascending => steamworks::LeaderboardSortMethod::Ascending,
            LeaderboardSortMethod::Descending => steamworks::LeaderboardSortMethod::Descending,
        };
        let display_type = match display_type {
            LeaderboardDisplayType::Numeric => steamworks::LeaderboardDisplayType::Numeric,
            LeaderboardDisplayType::TimeSeconds => steamworks::LeaderboardDisplayType::TimeSeconds,
            LeaderboardDisplayType::TimeMilliSeconds => {
                steamworks::LeaderboardDisplayType::TimeMilliSeconds
            }
        };

        let (tx, rx) = oneshot::channel();

        // Scoped so the non-Send UserStats handle is dropped before the await.
        {
            let client = crate::client::get_client();
            client.user_stats().find_or_create_leaderboard(
                &name,
                sort_method,
                display_type,
                move |result| {
                    let _ = tx.send(result);
                },
            );
        }

        finish_find(rx).await
    }

    async fn finish_find(
        rx: oneshot::Receiver<Result<Option<steamworks::Leaderboard>, steamworks::SteamError>>,
    ) -> Result<Option<Leaderboard>, Error> {
        rx.await
            .map_err(|_| Error::from_reason("Steam dropped the leaderboard lookup callback"))?
            .map(|found| found.map(Leaderboard::from_handle))
            .map_err(|e| Error::from_reason(format!("{e:?}")))
    }

    /// The crate builds a CString from the name and panics on a NUL byte, and
    /// a panic through the Steam callback machinery aborts the process.
    fn validate_name(name: &str) -> Result<(), Error> {
        if name.contains('\0') {
            return Err(Error::from_reason(format!(
                "Leaderboard name {name:?} contains a NUL byte"
            )));
        }
        if name.is_empty() {
            return Err(Error::from_reason("Leaderboard name must not be empty"));
        }
        Ok(())
    }
}
