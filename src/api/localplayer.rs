use napi::bindgen_prelude::BigInt;
use napi_derive::napi;
use steamworks::SteamId;

#[derive(Debug)]
#[napi(object)]
pub struct PlayerSteamId {
    pub steam_id64: BigInt,
    pub steam_id32: String,
    pub account_id: u32,
}

impl PlayerSteamId {
    pub(crate) fn from_steamid(steam_id: SteamId) -> Self {
        Self {
            steam_id64: steam_id.raw().into(),
            steam_id32: steam_id.steamid32(),
            account_id: steam_id.account_id().raw(),
        }
    }
}

#[napi]
pub mod localplayer {
    use super::PlayerSteamId;
    use napi::bindgen_prelude::Error;

    #[napi]
    pub fn get_steam_id() -> PlayerSteamId {
        let client = crate::client::get_client();
        let steam_id = client.user().steam_id();
        PlayerSteamId::from_steamid(steam_id)
    }

    #[napi]
    pub fn get_name() -> String {
        let client = crate::client::get_client();
        client.friends().name()
    }

    #[napi]
    pub fn get_level() -> u32 {
        let client = crate::client::get_client();
        client.user().level()
    }

    /// @returns the 2 digit ISO 3166-1-alpha-2 format country code which client is running in, e.g. "US" or "UK".
    #[napi]
    pub fn get_ip_country() -> String {
        let client = crate::client::get_client();
        client.utils().ip_country()
    }

    /// Set a rich presence key for the local user, or clear it when value is
    /// null (ISteamFriends::SetRichPresence).
    /// @returns true if Steam accepted the key/value; false when the key or
    /// value is too long, there are too many keys, or the key is one Steam
    /// rejects (for example a malformed steam_display token).
    #[napi]
    pub fn set_rich_presence(key: String, value: Option<String>) -> Result<bool, Error> {
        if key.contains('\0') || value.as_deref().is_some_and(|v| v.contains('\0')) {
            return Err(Error::from_reason(
                "Rich presence key or value contains a NUL byte",
            ));
        }
        let client = crate::client::get_client();
        Ok(client.friends().set_rich_presence(&key, value.as_deref()))
    }

    /// Clear every rich presence key for the local user.
    #[napi]
    pub fn clear_rich_presence() {
        let client = crate::client::get_client();
        client.friends().clear_rich_presence();
    }
}
