import client = require('./client')

/**
 * How a member's lobby state changed. Delivered as the variant name, not a
 * number, because callback payloads are serialized through serde.
 */
export type ChatMemberStateChange =
    /** This user has joined or is joining the lobby. */
    | 'Entered'
    /** This user has left or is leaving the lobby. */
    | 'Left'
    /** User disconnected without leaving the lobby first. */
    | 'Disconnected'
    /** The user has been kicked. */
    | 'Kicked'
    /** The user has been kicked and banned. */
    | 'Banned'

export interface CallbackReturns {
    [client.callback.SteamCallback.PersonaStateChange]: {
        steam_id: bigint
        flags: { bits: number }
    }
    [client.callback.SteamCallback.SteamServersConnected]: {}
    [client.callback.SteamCallback.SteamServersDisconnected]: {
        reason: number
    }
    [client.callback.SteamCallback.SteamServerConnectFailure]: {
        reason: number
        still_retrying: boolean
    }
    [client.callback.SteamCallback.LobbyDataUpdate]: {
        lobby: bigint
        member: bigint
        success: boolean
    }
    [client.callback.SteamCallback.LobbyChatUpdate]: {
        lobby: bigint
        user_changed: bigint
        making_change: bigint
        member_state_change: ChatMemberStateChange
    }
    [client.callback.SteamCallback.P2PSessionRequest]: {
        remote: bigint
    }
    [client.callback.SteamCallback.P2PSessionConnectFail]: {
        remote: bigint
        error: number
    }
    [client.callback.SteamCallback.GameLobbyJoinRequested]: {
        lobby_steam_id: bigint
        /**
         * The friend the join came through. Delivered as a JS number 0 when
         * there was no friend (ids only become bigint above 2^53).
         */
        friend_steam_id: bigint | number
    }
    [client.callback.SteamCallback.MicroTxnAuthorizationResponse]: {
        app_id: number
        order_id: number | bigint
        authorized: boolean
    }
    [client.callback.SteamCallback.GameRichPresenceJoinRequested]: {
        /**
         * The inviting friend. Delivered as a JS number 0 when the join did
         * not come from a friend (ids only become bigint above 2^53).
         */
        friend_steam_id: bigint | number
        /** The connect string, e.g. "+connect_lobby 1097752425246" */
        connect: string
    }
}
