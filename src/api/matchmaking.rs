use napi_derive::napi;

#[napi]
pub mod matchmaking {
    use crate::api::localplayer::PlayerSteamId;
    use napi::bindgen_prelude::{BigInt, Error};
    use std::collections::HashMap;
    use steamworks::sys;
    use steamworks::{
        DistanceFilter, LobbyId, LobbyKey, Matchmaking, NearFilter, NumberFilter, StringFilter,
    };
    use tokio::sync::oneshot;

    #[napi]
    pub enum LobbyType {
        Private,
        FriendsOnly,
        Public,
        Invisible,
    }

    /// Comparison operator for lobby list filters (ELobbyComparison).
    #[napi]
    pub enum LobbyComparison {
        EqualToOrLessThan,
        LessThan,
        Equal,
        GreaterThan,
        EqualToOrGreaterThan,
        NotEqual,
    }

    /// Geographic distance filter for lobby list requests (ELobbyDistanceFilter).
    #[napi]
    pub enum LobbyDistanceFilter {
        /// Only lobbies in the same immediate region.
        Close,
        /// Same region or nearby regions. This is the Steam default.
        Default,
        /// Up to half-way around the globe.
        Far,
        /// No filtering, will match lobbies as far as India to NY.
        Worldwide,
    }

    /// Match a lobby data string value.
    #[napi(object)]
    pub struct LobbyStringFilter {
        pub key: String,
        pub value: String,
        pub comparison: LobbyComparison,
    }

    /// Match a lobby data numeric value.
    #[napi(object)]
    pub struct LobbyNumberFilter {
        pub key: String,
        pub value: i32,
        pub comparison: LobbyComparison,
    }

    /// Sort results by closeness to a numeric lobby data value. Does not
    /// filter; lobbies further from the value simply appear later.
    #[napi(object)]
    pub struct LobbyNearValueFilter {
        pub key: String,
        pub value: i32,
    }

    /// Server-side filters applied to a lobby list request. Every field is
    /// optional; an empty object behaves like the unfiltered request.
    #[napi(object)]
    pub struct LobbyListFilter {
        pub string_filters: Option<Vec<LobbyStringFilter>>,
        pub number_filters: Option<Vec<LobbyNumberFilter>>,
        pub near_value_filters: Option<Vec<LobbyNearValueFilter>>,
        /// Only return lobbies with at least this many open slots.
        pub open_slots: Option<u32>,
        pub distance: Option<LobbyDistanceFilter>,
        /// Maximum number of lobbies to return.
        pub result_count: Option<u32>,
    }

    #[napi]
    pub struct Lobby {
        pub id: BigInt,
        lobby_id: LobbyId,
    }

    #[napi]
    impl Lobby {
        #[napi]
        pub async fn join(&self) -> Result<Lobby, Error> {
            join_lobby(self.id.clone()).await
        }

        #[napi]
        pub fn leave(&self) {
            let client = crate::client::get_client();
            client.matchmaking().leave_lobby(self.lobby_id);
        }

        #[napi]
        pub fn open_invite_dialog(&self) {
            let client = crate::client::get_client();
            client.friends().activate_invite_dialog(self.lobby_id);
        }

        #[napi]
        pub fn get_member_count(&self) -> usize {
            let client = crate::client::get_client();
            client.matchmaking().lobby_member_count(self.lobby_id)
        }

        #[napi]
        pub fn get_member_limit(&self) -> Option<usize> {
            let client = crate::client::get_client();
            client.matchmaking().lobby_member_limit(self.lobby_id)
        }

        #[napi]
        pub fn get_members(&self) -> Vec<PlayerSteamId> {
            let client = crate::client::get_client();
            client
                .matchmaking()
                .lobby_members(self.lobby_id)
                .into_iter()
                .map(PlayerSteamId::from_steamid)
                .collect()
        }

        #[napi]
        pub fn get_owner(&self) -> PlayerSteamId {
            let client = crate::client::get_client();
            PlayerSteamId::from_steamid(client.matchmaking().lobby_owner(self.lobby_id))
        }

        /// Transfer lobby ownership to another member. Only the current owner
        /// may call this, and the target must already be in the lobby.
        /// Members observe the change through the LobbyDataUpdate callback.
        #[napi]
        pub fn set_owner(&self, steam_id64: BigInt) -> bool {
            // Hold the client so the interface pointer below is valid.
            let _client = crate::client::get_client();
            unsafe {
                let mm = sys::SteamAPI_SteamMatchmaking_v009();
                if mm.is_null() {
                    return false;
                }
                sys::SteamAPI_ISteamMatchmaking_SetLobbyOwner(
                    mm,
                    self.lobby_id.raw(),
                    steam_id64.get_u64().1,
                )
            }
        }

        #[napi]
        pub fn set_joinable(&self, joinable: bool) -> bool {
            let client = crate::client::get_client();
            client
                .matchmaking()
                .set_lobby_joinable(self.lobby_id, joinable)
        }

        #[napi]
        pub fn get_data(&self, key: String) -> Option<String> {
            let client = crate::client::get_client();
            client
                .matchmaking()
                .lobby_data(self.lobby_id, &key)
                .map(|s| s.to_string())
        }

        #[napi]
        pub fn set_data(&self, key: String, value: String) -> bool {
            let client = crate::client::get_client();
            client
                .matchmaking()
                .set_lobby_data(self.lobby_id, &key, &value)
        }

        #[napi]
        pub fn delete_data(&self, key: String) -> bool {
            let client = crate::client::get_client();
            client.matchmaking().delete_lobby_data(self.lobby_id, &key)
        }

        /// Get an object containing all the lobby data
        #[napi]
        pub fn get_full_data(&self) -> HashMap<String, String> {
            let client = crate::client::get_client();

            let mut data = HashMap::new();

            let count = client.matchmaking().lobby_data_count(self.lobby_id);
            for i in 0..count {
                let maybe_lobby_data = client.matchmaking().lobby_data_by_index(self.lobby_id, i);

                if let Some((key, value)) = maybe_lobby_data {
                    data.insert(key, value);
                }
            }

            data
        }

        /// Merge current lobby data with provided data in a single batch
        /// @returns true if all data was set successfully
        #[napi]
        pub fn merge_full_data(&self, data: HashMap<String, String>) -> bool {
            let matchmaking = crate::client::get_client().matchmaking();
            data.iter()
                .map(|(key, value)| matchmaking.set_lobby_data(self.lobby_id, key, value))
                .all(|x| x)
        }
    }

    #[napi]
    pub async fn create_lobby(lobby_type: LobbyType, max_members: u32) -> Result<Lobby, Error> {
        let client = crate::client::get_client();

        let (tx, rx) = oneshot::channel();

        client.matchmaking().create_lobby(
            match lobby_type {
                LobbyType::Private => steamworks::LobbyType::Private,
                LobbyType::FriendsOnly => steamworks::LobbyType::FriendsOnly,
                LobbyType::Public => steamworks::LobbyType::Public,
                LobbyType::Invisible => steamworks::LobbyType::Invisible,
            },
            max_members,
            |result| {
                tx.send(result).unwrap();
            },
        );

        rx.await
            .unwrap()
            .map(|lobby_id| Lobby {
                id: BigInt::from(lobby_id.raw()),
                lobby_id,
            })
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    #[napi]
    pub async fn join_lobby(lobby_id: BigInt) -> Result<Lobby, Error> {
        let client = crate::client::get_client();

        let (tx, rx) = oneshot::channel();

        client.matchmaking().join_lobby(
            steamworks::LobbyId::from_raw(lobby_id.get_u64().1),
            |result| {
                tx.send(result).unwrap();
            },
        );

        rx.await
            .unwrap()
            .map(|lobby_id| Lobby {
                id: BigInt::from(lobby_id.raw()),
                lobby_id,
            })
            .map_err(|_| Error::from_reason("Failed to join lobby".to_string()))
    }

    /// Request the list of lobbies visible to this client. Filters are
    /// applied server-side and must be supplied with the request; they do
    /// not persist between calls.
    #[napi]
    pub async fn get_lobbies(filter: Option<LobbyListFilter>) -> Result<Vec<Lobby>, Error> {
        let client = crate::client::get_client();

        let (tx, rx) = oneshot::channel();

        // Scoped so the non-Send Matchmaking handle is dropped before the await.
        {
            let matchmaking = client.matchmaking();

            if let Some(filter) = filter {
                apply_lobby_list_filter(&matchmaking, filter)?;
            }

            matchmaking.request_lobby_list(|lobbies| {
                tx.send(lobbies).unwrap();
            });
        }

        rx.await
            .unwrap()
            .map(|lobbies| {
                lobbies
                    .iter()
                    .map(|lobby_id| Lobby {
                        id: BigInt::from(lobby_id.raw()),
                        lobby_id: *lobby_id,
                    })
                    .collect()
            })
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    fn apply_lobby_list_filter(
        matchmaking: &Matchmaking,
        filter: LobbyListFilter,
    ) -> Result<(), Error> {
        let key_error = |key: &str| {
            Error::from_reason(format!(
                "Lobby filter key \"{key}\" exceeds the maximum key length"
            ))
        };

        for f in filter.string_filters.unwrap_or_default() {
            let key = LobbyKey::try_new(&f.key).map_err(|_| key_error(&f.key))?;
            matchmaking.add_request_lobby_list_string_filter(StringFilter(
                key,
                &f.value,
                match f.comparison {
                    LobbyComparison::EqualToOrLessThan => {
                        steamworks::StringFilterKind::EqualToOrLessThan
                    }
                    LobbyComparison::LessThan => steamworks::StringFilterKind::LessThan,
                    LobbyComparison::Equal => steamworks::StringFilterKind::Equal,
                    LobbyComparison::GreaterThan => steamworks::StringFilterKind::GreaterThan,
                    LobbyComparison::EqualToOrGreaterThan => {
                        steamworks::StringFilterKind::EqualToOrGreaterThan
                    }
                    LobbyComparison::NotEqual => steamworks::StringFilterKind::NotEqual,
                },
            ));
        }

        for f in filter.number_filters.unwrap_or_default() {
            let key = LobbyKey::try_new(&f.key).map_err(|_| key_error(&f.key))?;
            matchmaking.add_request_lobby_list_numerical_filter(NumberFilter(
                key,
                f.value,
                match f.comparison {
                    LobbyComparison::EqualToOrLessThan => {
                        steamworks::ComparisonFilter::LessThanEqualTo
                    }
                    LobbyComparison::LessThan => steamworks::ComparisonFilter::LessThan,
                    LobbyComparison::Equal => steamworks::ComparisonFilter::Equal,
                    LobbyComparison::GreaterThan => steamworks::ComparisonFilter::GreaterThan,
                    LobbyComparison::EqualToOrGreaterThan => {
                        steamworks::ComparisonFilter::GreaterThanEqualTo
                    }
                    LobbyComparison::NotEqual => steamworks::ComparisonFilter::NotEqual,
                },
            ));
        }

        for f in filter.near_value_filters.unwrap_or_default() {
            let key = LobbyKey::try_new(&f.key).map_err(|_| key_error(&f.key))?;
            matchmaking.add_request_lobby_list_near_value_filter(NearFilter(key, f.value));
        }

        if let Some(open_slots) = filter.open_slots {
            matchmaking.set_request_lobby_list_slots_available_filter(open_slots.min(255) as u8);
        }

        if let Some(distance) = filter.distance {
            matchmaking.set_request_lobby_list_distance_filter(match distance {
                LobbyDistanceFilter::Close => DistanceFilter::Close,
                LobbyDistanceFilter::Default => DistanceFilter::Default,
                LobbyDistanceFilter::Far => DistanceFilter::Far,
                LobbyDistanceFilter::Worldwide => DistanceFilter::Worldwide,
            });
        }

        if let Some(count) = filter.result_count {
            matchmaking.set_request_lobby_list_result_count_filter(count as u64);
        }

        Ok(())
    }
}
