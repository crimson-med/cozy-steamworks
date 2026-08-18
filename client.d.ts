export declare function init(appId?: number | undefined | null): void
export declare function restartAppIfNecessary(appId: number): boolean
export declare function runCallbacks(): void
export interface PlayerSteamId {
  steamId64: bigint
  steamId32: string
  accountId: number
}
export declare namespace achievement {
  export function activate(achievement: string): boolean
  export function isActivated(achievement: string): boolean
  export function clear(achievement: string): boolean
  export function names(): Array<string>
}
export declare namespace apps {
  export function isSubscribedApp(appId: number): boolean
  export function isAppInstalled(appId: number): boolean
  export function isDlcInstalled(appId: number): boolean
  export function isSubscribedFromFreeWeekend(): boolean
  export function isVacBanned(): boolean
  export function isCybercafe(): boolean
  export function isLowViolence(): boolean
  export function isSubscribed(): boolean
  export function appBuildId(): number
  export function appInstallDir(appId: number): string
  export function appOwner(): PlayerSteamId
  export function availableGameLanguages(): Array<string>
  export function currentGameLanguage(): string
  export function currentBetaName(): string | null
}
export declare namespace auth {
  /**
   * @param steamId64 - The user steam id or game server steam id. Use as NetworkIdentity of the remote system that will authenticate the ticket. If it is peer-to-peer then the user steam ID. If it is a game server, then the game server steam ID may be used if it was obtained from a trusted 3rd party
   * @param timeoutSeconds - The number of seconds to wait for the ticket to be validated. Default value is 10 seconds.
   */
  export function getSessionTicketWithSteamId(steamId64: bigint, timeoutSeconds?: number | undefined | null): Promise<Ticket>
  /**
   * @param ip - The string of IPv4 or IPv6 address. Use as NetworkIdentity of the remote system that will authenticate the ticket.
   * @param timeoutSeconds - The number of seconds to wait for the ticket to be validated. Default value is 10 seconds.
   */
  export function getSessionTicketWithIp(ip: string, timeoutSeconds?: number | undefined | null): Promise<Ticket>
  export function getAuthTicketForWebApi(identity: string, timeoutSeconds?: number | undefined | null): Promise<Ticket>
  export class Ticket {
    cancel(): void
    getBytes(): Buffer
  }
}
export declare namespace callback {
  export const enum SteamCallback {
    PersonaStateChange = 0,
    SteamServersConnected = 1,
    SteamServersDisconnected = 2,
    SteamServerConnectFailure = 3,
    LobbyDataUpdate = 4,
    LobbyChatUpdate = 5,
    P2PSessionRequest = 6,
    P2PSessionConnectFail = 7,
    GameLobbyJoinRequested = 8,
    MicroTxnAuthorizationResponse = 9
  }
  export function register<C extends keyof import('./callbacks').CallbackReturns>(steamCallback: C, handler: (value: import('./callbacks').CallbackReturns[C]) => void): Handle
  export class Handle {
    disconnect(): void
  }
}
export declare namespace cloud {
  export function isEnabledForAccount(): boolean
  export function isEnabledForApp(): boolean
  export function setEnabledForApp(enabled: boolean): void
  export function readFile(name: string): string
  export function writeFile(name: string, content: string): boolean
  export function deleteFile(name: string): boolean
  export function fileExists(name: string): boolean
  export function listFiles(): Array<FileInfo>
  export class FileInfo {
    name: string
    size: bigint
  }
}
export declare namespace input {
  export const enum InputType {
    Unknown = 'Unknown',
    SteamController = 'SteamController',
    XBox360Controller = 'XBox360Controller',
    XBoxOneController = 'XBoxOneController',
    GenericGamepad = 'GenericGamepad',
    PS4Controller = 'PS4Controller',
    AppleMFiController = 'AppleMFiController',
    AndroidController = 'AndroidController',
    SwitchJoyConPair = 'SwitchJoyConPair',
    SwitchJoyConSingle = 'SwitchJoyConSingle',
    SwitchProController = 'SwitchProController',
    MobileTouch = 'MobileTouch',
    PS3Controller = 'PS3Controller',
    PS5Controller = 'PS5Controller',
    SteamDeckController = 'SteamDeckController'
  }
  export interface AnalogActionVector {
    x: number
    y: number
  }
  export function init(): void
  export function getControllers(): Array<Controller>
  export function getActionSet(actionSetName: string): bigint
  export function getDigitalAction(actionName: string): bigint
  export function getAnalogAction(actionName: string): bigint
  export function shutdown(): void
  export class Controller {
    activateActionSet(actionSetHandle: bigint): void
    isDigitalActionPressed(actionHandle: bigint): boolean
    getAnalogActionVector(actionHandle: bigint): AnalogActionVector
    getType(): InputType
    getHandle(): bigint
  }
}
export declare namespace localplayer {
  export function getSteamId(): PlayerSteamId
  export function getName(): string
  export function getLevel(): number
  /** @returns the 2 digit ISO 3166-1-alpha-2 format country code which client is running in, e.g. "US" or "UK". */
  export function getIpCountry(): string
  export function setRichPresence(key: string, value?: string | undefined | null): void
}
export declare namespace matchmaking {
  export const enum LobbyType {
    Private = 0,
    FriendsOnly = 1,
    Public = 2,
    Invisible = 3
  }
  /** Comparison operator for lobby list filters (ELobbyComparison). */
  export const enum LobbyComparison {
    EqualToOrLessThan = 0,
    LessThan = 1,
    Equal = 2,
    GreaterThan = 3,
    EqualToOrGreaterThan = 4,
    NotEqual = 5
  }
  /** Geographic distance filter for lobby list requests (ELobbyDistanceFilter). */
  export const enum LobbyDistanceFilter {
    /** Only lobbies in the same immediate region. */
    Close = 0,
    /** Same region or nearby regions. This is the Steam default. */
    Default = 1,
    /** Up to half-way around the globe. */
    Far = 2,
    /** No filtering, will match lobbies as far as India to NY. */
    Worldwide = 3
  }
  /** Match a lobby data string value. */
  export interface LobbyStringFilter {
    key: string
    value: string
    comparison: LobbyComparison
  }
  /** Match a lobby data numeric value. */
  export interface LobbyNumberFilter {
    key: string
    value: number
    comparison: LobbyComparison
  }
  /**
   * Sort results by closeness to a numeric lobby data value. Does not
   * filter; lobbies further from the value simply appear later.
   */
  export interface LobbyNearValueFilter {
    key: string
    value: number
  }
  /**
   * Server-side filters applied to a lobby list request. Every field is
   * optional; an empty object behaves like the unfiltered request.
   */
  export interface LobbyListFilter {
    stringFilters?: Array<LobbyStringFilter>
    numberFilters?: Array<LobbyNumberFilter>
    nearValueFilters?: Array<LobbyNearValueFilter>
    /** Only return lobbies with at least this many open slots. */
    openSlots?: number
    distance?: LobbyDistanceFilter
    /** Maximum number of lobbies to return. */
    resultCount?: number
  }
  export function createLobby(lobbyType: LobbyType, maxMembers: number): Promise<Lobby>
  export function joinLobby(lobbyId: bigint): Promise<Lobby>
  /**
   * Request the list of lobbies visible to this client. Filters are
   * applied server-side and must be supplied with the request; they do
   * not persist between calls.
   */
  export function getLobbies(filter?: LobbyListFilter | undefined | null): Promise<Array<Lobby>>
  export class Lobby {
    id: bigint
    join(): Promise<Lobby>
    leave(): void
    openInviteDialog(): void
    getMemberCount(): bigint
    getMemberLimit(): bigint | null
    getMembers(): Array<PlayerSteamId>
    getOwner(): PlayerSteamId
    /**
     * Transfer lobby ownership to another member. Only the current owner
     * may call this, and the target must already be in the lobby.
     * Members observe the change through the LobbyDataUpdate callback.
     */
    setOwner(steamId64: bigint): boolean
    setJoinable(joinable: boolean): boolean
    getData(key: string): string | null
    setData(key: string, value: string): boolean
    deleteData(key: string): boolean
    /** Get an object containing all the lobby data */
    getFullData(): Record<string, string>
    /**
     * Merge current lobby data with provided data in a single batch
     * @returns true if all data was set successfully
     */
    mergeFullData(data: Record<string, string>): boolean
  }
}
export declare namespace networking {
  export interface P2PPacket {
    data: Buffer
    size: number
    steamId: PlayerSteamId
  }
  /** The method used to send a packet */
  export const enum SendType {
    /**
     * Send the packet directly over udp.
     *
     * Can't be larger than 1200 bytes
     */
    Unreliable = 0,
    /**
     * Like `Unreliable` but doesn't buffer packets
     * sent before the connection has started.
     */
    UnreliableNoDelay = 1,
    /**
     * Reliable packet sending.
     *
     * Can't be larger than 1 megabyte.
     */
    Reliable = 2,
    /**
     * Like `Reliable` but applies the nagle
     * algorithm to packets being sent
     */
    ReliableWithBuffering = 3
  }
  export function sendP2PPacket(steamId64: bigint, sendType: SendType, data: Buffer): boolean
  export function isP2PPacketAvailable(): number
  export function readP2PPacket(size: number): P2PPacket
  export function acceptP2PSession(steamId64: bigint): void
}
export declare namespace networking_messages {
  export interface NetworkingMessagePacket {
    data: Buffer
    size: number
    channel: number
    steamId: PlayerSteamId
  }
  export const enum MessageSendType {
    /** Send the message unreliably. Can be lost, reordered, or duplicated. */
    Unreliable = 0,
    /**
     * Like `Unreliable` but does not buffer messages sent before the
     * session is established, and disables Nagle.
     */
    UnreliableNoDelay = 1,
    /** Reliable, ordered delivery. */
    Reliable = 2,
    /**
     * Reliable delivery, but disables Nagle buffering so the message is
     * sent immediately.
     */
    ReliableWithBuffering = 3
  }
  /**
   * High level state of a session with a peer, mirroring
   * ESteamNetworkingConnectionState.
   */
  export const enum SessionConnectionState {
    /** No session with this peer exists (or it has already been closed). */
    None = 0,
    Connecting = 1,
    FindingRoute = 2,
    Connected = 3,
    ClosedByPeer = 4,
    ProblemDetectedLocally = 5,
    /** Internal lingering states (FinWait / Linger / Dead). */
    Closing = 6
  }
  export interface SessionConnectionInfo {
    state: SessionConnectionState
    /** ESteamNetConnectionEnd value, 0 when the session is healthy. */
    endReason: number
    /** Non-localized diagnostic text describing why the session ended. */
    endDebug: string
    /** Internal connection description (type, peer, relay). Diagnostic only. */
    connectionDescription: string
    /**
     * Steam Datagram Relay POP the connection is routed through, as a
     * short code such as "ams". Empty when the connection is direct.
     */
    relayPop: string
    /** Data center the remote host is in, as a short code. Empty when unknown. */
    remotePop: string
    /** Whether the connection is currently routed through a relay. */
    usingRelay: boolean
    pingMs: number
    /** Packet delivery success rate measured locally, 0..1. */
    connectionQualityLocal: number
    /** Packet delivery success rate as observed by the remote host, 0..1. */
    connectionQualityRemote: number
    outPacketsPerSec: number
    outBytesPerSec: number
    inPacketsPerSec: number
    inBytesPerSec: number
    pendingUnreliableBytes: number
    pendingReliableBytes: number
    sentUnackedReliableBytes: number
  }
  /**
   * Accept every incoming session. Convenient for a private playtest, but a
   * shipped host should allow only the peers it knows joined its lobby.
   */
  export function setAllowAllSessions(allow: boolean): void
  /** Allow a specific peer, normally called when a lobby member joins. */
  export function allowPeer(steamId64: bigint): void
  /** Revoke a peer, normally called when a lobby member leaves. */
  export function disallowPeer(steamId64: bigint): void
  /**
   * Whether a peer is currently allowed by the session policy, either
   * through `allowPeer` or `setAllowAllSessions(true)`.
   */
  export function isPeerAllowed(steamId64: bigint): boolean
  /** Clear the per-peer allow list. Does not touch `setAllowAllSessions`. */
  export function clearAllowedPeers(): void
  /**
   * Register the session request/failed handlers. Call once after init.
   * The handlers fire during `run_callbacks()`.
   */
  export function initSessionCallbacks(onSessionRequest: (steamId64: bigint, accepted: boolean) => void, onSessionFailed: (steamId64: bigint) => void): void
  export function sendMessageToUser(steamId64: bigint, sendType: MessageSendType, data: Buffer, channel: number): boolean
  export function receiveMessagesOnChannel(channel: number, batchSize: number): Array<NetworkingMessagePacket>
  /**
   * Close the session with a peer, discarding any queued messages.
   * Required to acknowledge a broken session before opening a new one.
   * @returns true if a session existed and was closed
   */
  export function closeSessionWithUser(steamId64: bigint): boolean
  /**
   * Query the state of the session with a peer, plus real-time statistics
   * when the session exists. `state` is `None` when there is no session.
   */
  export function getSessionConnectionInfo(steamId64: bigint): SessionConnectionInfo
}
export declare namespace overlay {
  export const enum Dialog {
    Friends = 0,
    Community = 1,
    Players = 2,
    Settings = 3,
    OfficialGameGroup = 4,
    Stats = 5,
    Achievements = 6
  }
  export const enum StoreFlag {
    None = 0,
    AddToCart = 1,
    AddToCartAndShow = 2
  }
  export function activateDialog(dialog: Dialog): void
  export function activateDialogToUser(dialog: Dialog, steamId64: bigint): void
  export function activateInviteDialog(lobbyId: bigint): void
  export function activateToWebPage(url: string): void
  export function activateToStore(appId: number, flag: StoreFlag): void
}
export declare namespace stats {
  export function getInt(name: string): number | null
  export function setInt(name: string, value: number): boolean
  export function store(): boolean
  export function resetAll(achievementsToo: boolean): boolean
}
export declare namespace utils {
  export function getAppId(): number
  export function getServerRealTime(): number
  export function isSteamRunningOnSteamDeck(): boolean
  export const enum GamepadTextInputMode {
    Normal = 0,
    Password = 1
  }
  export const enum GamepadTextInputLineMode {
    SingleLine = 0,
    MultipleLines = 1
  }
  /** @returns the entered text, or null if cancelled or could not show the input */
  export function showGamepadTextInput(inputMode: GamepadTextInputMode, inputLineMode: GamepadTextInputLineMode, description: string, maxCharacters: number, existingText?: string | undefined | null): Promise<string | null>
  export const enum FloatingGamepadTextInputMode {
    SingleLine = 0,
    MultipleLines = 1,
    Email = 2,
    Numeric = 3
  }
  /** @returns true if the floating keyboard was shown, otherwise, false */
  export function showFloatingGamepadTextInput(keyboardMode: FloatingGamepadTextInputMode, x: number, y: number, width: number, height: number): Promise<boolean>
}
