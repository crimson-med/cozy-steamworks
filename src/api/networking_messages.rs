use napi_derive::napi;

#[napi]
pub mod networking_messages {
    use napi::{
        bindgen_prelude::{BigInt, Buffer},
        threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode},
        Error, JsFunction,
    };
    use std::collections::HashSet;
    use std::ffi::CStr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use steamworks::networking_types::{NetworkingIdentity, SendFlags};
    use steamworks::sys;
    use steamworks::SteamId;

    use crate::api::localplayer::PlayerSteamId;

    // A session request must be accepted or rejected synchronously inside the
    // Rust callback, so the decision cannot round-trip through JavaScript.
    // Instead JS declares a policy up front (the host allows the peers it has
    // seen join its lobby) and is notified after the fact.
    static ALLOW_ALL: AtomicBool = AtomicBool::new(false);

    lazy_static::lazy_static! {
        static ref ALLOWED: Mutex<HashSet<u64>> = Mutex::new(HashSet::new());
    }

    #[napi(object)]
    pub struct NetworkingMessagePacket {
        pub data: Buffer,
        pub size: i32,
        pub channel: i32,
        pub steam_id: PlayerSteamId,
    }

    #[napi]
    pub enum MessageSendType {
        /// Send the message unreliably. Can be lost, reordered, or duplicated.
        Unreliable,
        /// Like `Unreliable` but does not buffer messages sent before the
        /// session is established, and disables Nagle.
        UnreliableNoDelay,
        /// Reliable, ordered delivery.
        Reliable,
        /// Reliable delivery with Nagle disabled, so the message goes out
        /// immediately instead of being coalesced with the next one.
        ReliableNoNagle,
    }

    /// High level state of a session with a peer, mirroring
    /// ESteamNetworkingConnectionState.
    #[napi]
    pub enum SessionConnectionState {
        /// No session with this peer exists (or it has already been closed).
        None,
        Connecting,
        FindingRoute,
        Connected,
        ClosedByPeer,
        ProblemDetectedLocally,
        /// Internal lingering states (FinWait / Linger / Dead).
        Closing,
    }

    #[napi(object)]
    pub struct SessionConnectionInfo {
        pub state: SessionConnectionState,
        /// ESteamNetConnectionEnd value, 0 when the session is healthy.
        pub end_reason: i32,
        /// Non-localized diagnostic text describing why the session ended.
        pub end_debug: String,
        /// Internal connection description (type, peer, relay). Diagnostic only.
        pub connection_description: String,
        /// Steam Datagram Relay POP the connection is routed through, as a
        /// short code such as "ams". Empty when not routed through SDR.
        pub relay_pop: String,
        /// Data center the remote host is in, as a short code. Empty when unknown.
        pub remote_pop: String,
        /// Whether the connection is currently routed through any relay
        /// (SDR or TURN) rather than direct.
        pub using_relay: bool,
        pub ping_ms: i32,
        /// Packet delivery success rate measured locally, 0..1.
        pub connection_quality_local: f64,
        /// Packet delivery success rate as observed by the remote host, 0..1.
        pub connection_quality_remote: f64,
        pub out_packets_per_sec: f64,
        pub out_bytes_per_sec: f64,
        pub in_packets_per_sec: f64,
        pub in_bytes_per_sec: f64,
        pub pending_unreliable_bytes: i32,
        pub pending_reliable_bytes: i32,
        pub sent_unacked_reliable_bytes: i32,
    }

    /// Accept every incoming session. Convenient for a private playtest, but a
    /// shipped host should allow only the peers it knows joined its lobby.
    #[napi]
    pub fn set_allow_all_sessions(allow: bool) {
        ALLOW_ALL.store(allow, Ordering::Relaxed);
    }

    /// Allow a specific peer, normally called when a lobby member joins.
    ///
    /// The decision is made when the peer's first message arrives, so this
    /// must be called before that. If a peer's message beats the allow call
    /// the session is rejected once; the sender sees it through
    /// `onSessionFailed`, must call `closeSessionWithUser`, and its next send
    /// opens a fresh session request that will then be accepted.
    #[napi]
    pub fn allow_peer(steam_id64: BigInt) {
        ALLOWED.lock().unwrap().insert(steam_id64.get_u64().1);
    }

    /// Revoke a peer, normally called when a lobby member leaves.
    #[napi]
    pub fn disallow_peer(steam_id64: BigInt) {
        ALLOWED.lock().unwrap().remove(&steam_id64.get_u64().1);
    }

    /// Whether a peer is currently allowed by the session policy, either
    /// through `allowPeer` or `setAllowAllSessions(true)`.
    #[napi]
    pub fn is_peer_allowed(steam_id64: BigInt) -> bool {
        ALLOW_ALL.load(Ordering::Relaxed)
            || ALLOWED.lock().unwrap().contains(&steam_id64.get_u64().1)
    }

    /// Clear the per-peer allow list. Does not touch `setAllowAllSessions`.
    #[napi]
    pub fn clear_allowed_peers() {
        ALLOWED.lock().unwrap().clear();
    }

    /// Register the session request/failed handlers. Call once after init.
    /// The handlers fire during `run_callbacks()`.
    ///
    /// `onSessionRequest` reports the peer and whether the policy accepted it.
    /// `onSessionFailed` fires when a session with a peer breaks; call
    /// `closeSessionWithUser` for that peer before sending to it again.
    #[napi]
    pub fn init_session_callbacks(
        #[napi(ts_arg_type = "(steamId64: bigint, accepted: boolean) => void")]
        on_session_request: JsFunction,
        #[napi(ts_arg_type = "(steamId64: bigint) => void")] on_session_failed: JsFunction,
    ) -> Result<(), Error> {
        let requested: ThreadsafeFunction<(BigInt, bool), ErrorStrategy::Fatal> =
            on_session_request.create_threadsafe_function(0, |ctx| {
                let (id, accepted): (BigInt, bool) = ctx.value;
                Ok(vec![
                    ctx.env
                        .create_bigint_from_u64(id.get_u64().1)?
                        .into_unknown()?,
                    ctx.env.get_boolean(accepted)?.into_unknown(),
                ])
            })?;

        let failed: ThreadsafeFunction<BigInt, ErrorStrategy::Fatal> = on_session_failed
            .create_threadsafe_function(0, |ctx| {
                let id: BigInt = ctx.value;
                Ok(vec![ctx.env.create_bigint_from_u64(id.get_u64().1)?])
            })?;

        let client = crate::client::get_client();

        client
            .networking_messages()
            .session_request_callback(move |request| {
                let remote = request.remote().steam_id().map(|id| id.raw()).unwrap_or(0);
                let permitted =
                    ALLOW_ALL.load(Ordering::Relaxed) || ALLOWED.lock().unwrap().contains(&remote);
                if permitted {
                    request.accept();
                } else {
                    request.reject();
                }
                requested.call(
                    (BigInt::from(remote), permitted),
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            });

        client
            .networking_messages()
            .session_failed_callback(move |info| {
                let remote = info
                    .identity_remote()
                    .and_then(|id| id.steam_id())
                    .map(|id| id.raw())
                    .unwrap_or(0);
                failed.call(
                    BigInt::from(remote),
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            });

        Ok(())
    }

    /// Send a message to a peer, opening a session implicitly if needed.
    ///
    /// Throws when Steam refuses the send. The error message is the EResult
    /// name, for example `NoConnection` (the session is broken or was closed
    /// by the peer: call `closeSessionWithUser` before retrying),
    /// `LimitExceeded` (message too large or too much queued), or
    /// `InvalidParam`.
    #[napi]
    pub fn send_message_to_user(
        steam_id64: BigInt,
        send_type: MessageSendType,
        data: Buffer,
        channel: u32,
    ) -> Result<(), Error> {
        let flags = match send_type {
            MessageSendType::Unreliable => SendFlags::UNRELIABLE,
            MessageSendType::UnreliableNoDelay => SendFlags::UNRELIABLE_NO_DELAY,
            MessageSendType::Reliable => SendFlags::RELIABLE,
            MessageSendType::ReliableNoNagle => SendFlags::RELIABLE_NO_NAGLE,
        };
        let identity = NetworkingIdentity::new_steam_id(SteamId::from_raw(steam_id64.get_u64().1));
        crate::client::get_client()
            .networking_messages()
            .send_message_to_user(identity, flags, &data, channel)
            .map_err(|e| Error::from_reason(format!("{e:?}")))
    }

    #[napi]
    pub fn receive_messages_on_channel(
        channel: u32,
        batch_size: u32,
    ) -> Vec<NetworkingMessagePacket> {
        crate::client::get_client()
            .networking_messages()
            .receive_messages_on_channel(channel, batch_size as usize)
            .into_iter()
            .map(|message| {
                let data = message.data().to_vec();
                NetworkingMessagePacket {
                    size: data.len() as i32,
                    channel: message.channel(),
                    steam_id: PlayerSteamId::from_steamid(
                        message
                            .identity_peer()
                            .steam_id()
                            .unwrap_or_else(|| SteamId::from_raw(0)),
                    ),
                    data: data.into(),
                }
            })
            .collect()
    }

    /// Close the session with a peer, discarding any queued messages.
    /// Required to acknowledge a broken session before opening a new one.
    /// @returns true if a session existed and was closed
    #[napi]
    pub fn close_session_with_user(steam_id64: BigInt) -> bool {
        // Hold the client so the interface pointer below is valid.
        let _client = crate::client::get_client();
        unsafe {
            let net = sys::SteamAPI_SteamNetworkingMessages_SteamAPI_v002();
            if net.is_null() {
                return false;
            }
            let identity = steam_identity(steam_id64.get_u64().1);
            sys::SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser(net, &identity)
        }
    }

    /// Query the state of the session with a peer, plus real-time statistics
    /// when the session exists. `state` is `None` when there is no session.
    #[napi]
    pub fn get_session_connection_info(steam_id64: BigInt) -> SessionConnectionInfo {
        // Hold the client so the interface pointer below is valid.
        let _client = crate::client::get_client();
        unsafe {
            let net = sys::SteamAPI_SteamNetworkingMessages_SteamAPI_v002();
            let identity = steam_identity(steam_id64.get_u64().1);
            let mut info: sys::SteamNetConnectionInfo_t = std::mem::zeroed();
            let mut status: sys::SteamNetConnectionRealTimeStatus_t = std::mem::zeroed();

            let raw_state = if net.is_null() {
                sys::ESteamNetworkingConnectionState::k_ESteamNetworkingConnectionState_None
            } else {
                sys::SteamAPI_ISteamNetworkingMessages_GetSessionConnectionInfo(
                    net,
                    &identity,
                    &mut info,
                    &mut status,
                )
            };

            let state = connection_state(raw_state);
            let has_session = !matches!(state, SessionConnectionState::None);

            SessionConnectionInfo {
                state,
                end_reason: if has_session { info.m_eEndReason } else { 0 },
                end_debug: c_chars_to_string(&info.m_szEndDebug),
                connection_description: c_chars_to_string(&info.m_szConnectionDescription),
                relay_pop: pop_id_to_string(info.m_idPOPRelay),
                remote_pop: pop_id_to_string(info.m_idPOPRemote),
                using_relay: has_session
                    && (info.m_nFlags & sys::k_nSteamNetworkConnectionInfoFlags_Relayed) != 0,
                ping_ms: status.m_nPing,
                connection_quality_local: status.m_flConnectionQualityLocal as f64,
                connection_quality_remote: status.m_flConnectionQualityRemote as f64,
                out_packets_per_sec: status.m_flOutPacketsPerSec as f64,
                out_bytes_per_sec: status.m_flOutBytesPerSec as f64,
                in_packets_per_sec: status.m_flInPacketsPerSec as f64,
                in_bytes_per_sec: status.m_flInBytesPerSec as f64,
                pending_unreliable_bytes: status.m_cbPendingUnreliable,
                pending_reliable_bytes: status.m_cbPendingReliable,
                sent_unacked_reliable_bytes: status.m_cbSentUnackedReliable,
            }
        }
    }

    unsafe fn steam_identity(steam_id64: u64) -> sys::SteamNetworkingIdentity {
        let mut identity: sys::SteamNetworkingIdentity = std::mem::zeroed();
        sys::SteamAPI_SteamNetworkingIdentity_Clear(&mut identity);
        sys::SteamAPI_SteamNetworkingIdentity_SetSteamID64(&mut identity, steam_id64);
        identity
    }

    fn connection_state(state: sys::ESteamNetworkingConnectionState) -> SessionConnectionState {
        use sys::ESteamNetworkingConnectionState as S;
        match state {
            S::k_ESteamNetworkingConnectionState_None => SessionConnectionState::None,
            S::k_ESteamNetworkingConnectionState_Connecting => SessionConnectionState::Connecting,
            S::k_ESteamNetworkingConnectionState_FindingRoute => {
                SessionConnectionState::FindingRoute
            }
            S::k_ESteamNetworkingConnectionState_Connected => SessionConnectionState::Connected,
            S::k_ESteamNetworkingConnectionState_ClosedByPeer => {
                SessionConnectionState::ClosedByPeer
            }
            S::k_ESteamNetworkingConnectionState_ProblemDetectedLocally => {
                SessionConnectionState::ProblemDetectedLocally
            }
            _ => SessionConnectionState::Closing,
        }
    }

    fn c_chars_to_string(chars: &[std::os::raw::c_char]) -> String {
        // The SDK NUL-terminates these buffers; fall back to the full slice
        // if it ever does not.
        let bytes: Vec<u8> = chars.iter().map(|&c| c as u8).collect();
        match CStr::from_bytes_until_nul(&bytes) {
            Ok(cstr) => cstr.to_string_lossy().into_owned(),
            Err(_) => String::from_utf8_lossy(&bytes).into_owned(),
        }
    }

    /// A SteamNetworkingPOPID packs three or four ASCII characters into a
    /// u32, most significant byte first. 0 means unknown / not applicable.
    fn pop_id_to_string(pop: sys::SteamNetworkingPOPID) -> String {
        if pop == 0 {
            return String::new();
        }
        pop.to_be_bytes()
            .iter()
            .filter(|&&b| b != 0)
            .map(|&b| b as char)
            .collect()
    }
}
