use napi_derive::napi;

#[napi]
pub mod global_stats {
    use napi::bindgen_prelude::{BigInt, Error};
    use tokio::sync::oneshot;

    /// The SDK stores at most 60 days of aggregated history.
    const MAX_HISTORY_DAYS: u32 = 60;

    /// Request the aggregated global totals for this app's global stats, plus
    /// `historyDays` days of day-by-day history.
    ///
    /// A stat is only readable here when it is marked as aggregated in the
    /// Steamworks App Admin. Steam starts aggregating from the moment that is
    /// switched on and the totals trail live play by roughly a day, so this is
    /// not real time data.
    ///
    /// `historyDays` is clamped to 60, the SDK maximum. Pass 0 for totals only.
    /// The getters below return nothing until this resolves.
    ///
    /// Steam reports a per-request EResult that the underlying crate does not
    /// surface, so this resolves for any request Steam answered, including one
    /// it answered with a failure. An app with no aggregated stats therefore
    /// resolves here and reads back null and empty arrays. Rejection means the
    /// request itself never completed.
    #[napi]
    pub async fn request_global_stats(history_days: u32) -> Result<(), Error> {
        let days = history_days.min(MAX_HISTORY_DAYS) as i32;

        let (tx, rx) = oneshot::channel();

        // Scoped so the non-Send UserStats handle is dropped before the await.
        {
            let client = crate::client::get_client();
            client
                .user_stats()
                .request_global_stats(days, move |result| {
                    let _ = tx.send(result);
                });
        }

        rx.await
            .map_err(|_| Error::from_reason("Steam dropped the global stats callback"))?
            .map(|_| ())
            .map_err(|e| Error::from_reason(format!("{e:?}")))
    }

    /// The aggregated lifetime total of an INT global stat.
    /// @returns null when the stat is not aggregated, is not an INT stat, or
    /// `requestGlobalStats` has not resolved yet.
    #[napi]
    pub fn get_global_stat_int64(name: String) -> Result<Option<BigInt>, Error> {
        validate_name(&name)?;
        let client = crate::client::get_client();
        Ok(client
            .user_stats()
            .get_global_stat_i64(&name)
            .ok()
            .map(BigInt::from))
    }

    /// The aggregated lifetime total of a FLOAT or AVGRATE global stat.
    /// @returns null when the stat is not aggregated, is not a float stat, or
    /// `requestGlobalStats` has not resolved yet.
    #[napi]
    pub fn get_global_stat_double(name: String) -> Result<Option<f64>, Error> {
        validate_name(&name)?;
        let client = crate::client::get_client();
        Ok(client.user_stats().get_global_stat_f64(&name).ok())
    }

    /// Day-by-day history for an INT global stat, most recent day first, so
    /// index 0 is today and index 1 is yesterday.
    ///
    /// `days` is clamped to 60 and should not exceed the `historyDays` passed
    /// to `requestGlobalStats`. The result is only as long as the number of
    /// days Steam actually returned, and is empty when the stat is not
    /// aggregated or the request has not resolved.
    #[napi]
    pub fn get_global_stat_history_int64(name: String, days: u32) -> Result<Vec<BigInt>, Error> {
        validate_name(&name)?;
        let days = days.min(MAX_HISTORY_DAYS) as usize;
        if days == 0 {
            return Ok(Vec::new());
        }
        let client = crate::client::get_client();
        Ok(client
            .user_stats()
            .get_global_stat_history_i64(&name, days)
            .unwrap_or_default()
            .into_iter()
            .map(BigInt::from)
            .collect())
    }

    /// The crate builds a CString from the name and reports a NUL byte the
    /// same way it reports a missing stat, so reject it up front instead.
    fn validate_name(name: &str) -> Result<(), Error> {
        if name.contains('\0') {
            return Err(Error::from_reason(format!(
                "Global stat name {name:?} contains a NUL byte"
            )));
        }
        Ok(())
    }
}
