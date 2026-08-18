use napi_derive::napi;

#[napi]
pub mod friends {
    use napi::bindgen_prelude::{BigInt, Error};
    use steamworks::{FriendFlags, FriendState as SdkFriendState, SteamId};

    use crate::api::localplayer::PlayerSteamId;

    /// Mirrors steamworks::FriendState. Values follow declaration order here,
    /// not the SDK's EPersonaState numbering.
    #[napi]
    pub enum FriendState {
        Offline,
        Online,
        Invisible,
        Busy,
        Away,
        Snooze,
        LookingToTrade,
        LookingToPlay,
    }

    fn map_state(s: SdkFriendState) -> FriendState {
        match s {
            SdkFriendState::Offline => FriendState::Offline,
            SdkFriendState::Online => FriendState::Online,
            SdkFriendState::Invisible => FriendState::Invisible,
            SdkFriendState::Busy => FriendState::Busy,
            SdkFriendState::Away => FriendState::Away,
            SdkFriendState::Snooze => FriendState::Snooze,
            SdkFriendState::LookingToTrade => FriendState::LookingToTrade,
            SdkFriendState::LookingToPlay => FriendState::LookingToPlay,
        }
    }

    #[napi(object)]
    pub struct FriendInfo {
        pub steam_id: PlayerSteamId,
        pub name: String,
        pub state: FriendState,
        /// App id the friend is currently playing, 0 when not in a game.
        pub playing_app_id: u32,
    }

    /// The local user's immediate friends (FriendFlags::IMMEDIATE), with
    /// their online state and the app they are in.
    // catch_unwind: the crate's Friend::state() panics on a persona state it
    // does not know; surface that as a JS error instead of aborting.
    #[napi(catch_unwind)]
    pub fn get_friends() -> Vec<FriendInfo> {
        let client = crate::client::get_client();
        client
            .friends()
            .get_friends(FriendFlags::IMMEDIATE)
            .into_iter()
            .map(|f| FriendInfo {
                steam_id: PlayerSteamId::from_steamid(f.id()),
                name: f.name(),
                state: map_state(f.state()),
                playing_app_id: f.game_played().map(|g| g.game.app_id().0).unwrap_or(0),
            })
            .collect()
    }

    /// Persona name of any Steam user. Steam returns a placeholder such as
    /// "[unknown]" when it has not cached the user; call
    /// requestUserInformation first for users who are not friends.
    #[napi]
    pub fn get_friend_name(steam_id64: BigInt) -> String {
        let client = crate::client::get_client();
        client
            .friends()
            .get_friend(SteamId::from_raw(steam_id64.get_u64().1))
            .name()
    }

    /// Ask Steam to fetch a user's persona name/avatar. Returns true when a
    /// fetch was started (PersonaStateChange fires when it lands), false when
    /// the data is already cached.
    #[napi]
    pub fn request_user_information(steam_id64: BigInt, name_only: bool) -> bool {
        let client = crate::client::get_client();
        client
            .friends()
            .request_user_information(SteamId::from_raw(steam_id64.get_u64().1), name_only)
    }

    /// Invite a friend to the running game with a connect string
    /// (ISteamFriends::InviteUserToGame). Accepting adds the string to the
    /// game's command line, or delivers GameRichPresenceJoinRequested when
    /// the game is already running. Does not need the overlay.
    #[napi]
    pub fn invite_user_to_game(steam_id64: BigInt, connect_string: String) -> Result<(), Error> {
        if connect_string.contains('\0') {
            return Err(Error::from_reason("Connect string contains a NUL byte"));
        }
        let client = crate::client::get_client();
        client
            .friends()
            .get_friend(SteamId::from_raw(steam_id64.get_u64().1))
            .invite_user_to_game(&connect_string);
        Ok(())
    }
}
