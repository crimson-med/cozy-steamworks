use napi_derive::napi;

#[napi]
pub mod callback {
    use napi::{
        threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
        JsFunction,
    };

    /// Local mirror of steamworks::GameRichPresenceJoinRequested that decodes
    /// the connect string lossily. The crate's version panics on a payload
    /// that is not NUL-terminated or not UTF-8, and a panic inside
    /// SteamAPI_RunCallbacks aborts the process. The payload is chosen by
    /// whoever sent the invite, so it must never be trusted to be well formed.
    #[derive(serde::Serialize)]
    struct GameRichPresenceJoinRequested {
        friend_steam_id: u64,
        connect: String,
    }

    unsafe impl steamworks::Callback for GameRichPresenceJoinRequested {
        const ID: i32 = steamworks::sys::GameRichPresenceJoinRequested_t_k_iCallback as i32;

        unsafe fn from_raw(raw: *mut std::ffi::c_void) -> Self {
            let cb = raw
                .cast::<steamworks::sys::GameRichPresenceJoinRequested_t>()
                .read_unaligned();
            let bytes: Vec<u8> = cb.m_rgchConnect.iter().map(|&c| c as u8).collect();
            let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
            Self {
                friend_steam_id: cb.m_steamIDFriend.m_steamid.m_unAll64Bits,
                connect: String::from_utf8_lossy(&bytes[..end]).into_owned(),
            }
        }
    }

    #[napi]
    pub struct Handle {
        handle: Option<steamworks::CallbackHandle>,
    }

    #[napi]
    impl Handle {
        #[napi]
        pub fn disconnect(&mut self) {
            // CallbackHandle unregisters on Drop since steamworks 0.13.
            self.handle.take();
        }
    }

    #[napi]
    pub enum SteamCallback {
        PersonaStateChange,
        SteamServersConnected,
        SteamServersDisconnected,
        SteamServerConnectFailure,
        LobbyDataUpdate,
        LobbyChatUpdate,
        P2PSessionRequest,
        P2PSessionConnectFail,
        GameLobbyJoinRequested,
        MicroTxnAuthorizationResponse,
        GameRichPresenceJoinRequested,
    }

    #[napi(ts_generic_types = "C extends keyof import('./callbacks').CallbackReturns")]
    pub fn register(
        #[napi(ts_arg_type = "C")] steam_callback: SteamCallback,
        #[napi(ts_arg_type = "(value: import('./callbacks').CallbackReturns[C]) => void")] handler: JsFunction,
    ) -> Handle {
        let threadsafe_handler: ThreadsafeFunction<serde_json::Value, ErrorStrategy::Fatal> =
            handler
                .create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))
                .unwrap();

        let handle = match steam_callback {
            SteamCallback::PersonaStateChange => {
                register_callback::<steamworks::PersonaStateChange>(threadsafe_handler)
            }
            SteamCallback::SteamServersConnected => {
                register_callback::<steamworks::SteamServersConnected>(threadsafe_handler)
            }
            SteamCallback::SteamServersDisconnected => {
                register_callback::<steamworks::SteamServersDisconnected>(threadsafe_handler)
            }
            SteamCallback::SteamServerConnectFailure => {
                register_callback::<steamworks::SteamServerConnectFailure>(threadsafe_handler)
            }
            SteamCallback::LobbyDataUpdate => {
                register_callback::<steamworks::LobbyDataUpdate>(threadsafe_handler)
            }
            SteamCallback::LobbyChatUpdate => {
                register_callback::<steamworks::LobbyChatUpdate>(threadsafe_handler)
            }
            SteamCallback::P2PSessionRequest => {
                register_callback::<steamworks::P2PSessionRequest>(threadsafe_handler)
            }
            SteamCallback::P2PSessionConnectFail => {
                register_callback::<steamworks::P2PSessionConnectFail>(threadsafe_handler)
            }
            SteamCallback::GameLobbyJoinRequested => {
                register_callback::<steamworks::GameLobbyJoinRequested>(threadsafe_handler)
            }
            SteamCallback::MicroTxnAuthorizationResponse => {
                register_callback::<steamworks::MicroTxnAuthorizationResponse>(threadsafe_handler)
            }
            SteamCallback::GameRichPresenceJoinRequested => {
                register_callback::<GameRichPresenceJoinRequested>(threadsafe_handler)
            }
        };

        Handle {
            handle: Some(handle),
        }
    }

    fn register_callback<C>(
        threadsafe_handler: ThreadsafeFunction<serde_json::Value, ErrorStrategy::Fatal>,
    ) -> steamworks::CallbackHandle
    where
        C: steamworks::Callback + serde::Serialize,
    {
        let client = crate::client::get_client();
        client.register_callback(move |value: C| {
            let value = serde_json::to_value(&value).unwrap();
            threadsafe_handler.call(value, ThreadsafeFunctionCallMode::Blocking);
        })
    }
}
