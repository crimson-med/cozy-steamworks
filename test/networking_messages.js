// Two-machine chat over ISteamNetworkingMessages.
//
// Machine A: run with no argument, note the printed lobby id.
// Machine B: run and paste that lobby id when prompted.
// Both then type lines; each line is sent Reliable on channel 0 to every
// other lobby member and printed on receipt.
//
// Commands: /friends lists friends, /invite <steamId64> sends a lobby invite
// through Steam chat (no overlay needed), /info prints session state.

const rl = require('readline');
const { init, SteamCallback } = require('../index.js')

const CHANNEL = 0

const client = init(480)
const me = client.localplayer.getSteamId().steamId64

// Sessions are accepted synchronously in Rust against an allow list, so the
// host must allow a peer before that peer's first message can be accepted.
client.networking_messages.initSessionCallbacks(
    (steamId64, accepted) => console.log(`Session request from ${steamId64}: ${accepted ? 'accepted' : 'rejected'}`),
    (steamId64) => {
        console.log(`Session with ${steamId64} failed:`, client.networking_messages.getSessionConnectionInfo(steamId64))
        // Acknowledge the broken session so the next send opens a new one.
        client.networking_messages.closeSessionWithUser(steamId64)
    },
)

// Keep the handles alive: dropping one unregisters its callback.
let lobbyChatUpdateHandle
const joinRequestedHandle = client.callback.register(SteamCallback.GameLobbyJoinRequested, ({ lobby_steam_id, friend_steam_id }) => {
    console.log(`GameLobbyJoinRequested: lobby ${lobby_steam_id} from ${friend_steam_id} (invite accepted while running)`)
})
const richPresenceJoinHandle = client.callback.register(SteamCallback.GameRichPresenceJoinRequested, ({ friend_steam_id, connect }) => {
    console.log(`GameRichPresenceJoinRequested: "${connect}" from ${friend_steam_id}`)
})
if (process.argv.some(a => a.startsWith('+connect_lobby'))) {
    console.log(`Launched with ${process.argv.filter(a => a.includes('connect_lobby')).join(' ')} (invite accepted while not running)`)
}

const rlInterface = rl.createInterface({
    input: process.stdin,
    output: process.stdout
})

rlInterface.question('Enter a lobby id or press enter to create one: ', async lobbyId => {
    let lobby
    if (lobbyId) {
        lobby = await client.matchmaking.joinLobby(BigInt(lobbyId))
    } else {
        lobby = await client.matchmaking.createLobby(client.matchmaking.LobbyType.Public, 10)
        console.log(`Created lobby with id ${lobby.id}`)
    }

    const allowMembers = () => {
        lobby.getMembers().forEach(peer => {
            if (peer.steamId64 !== me) {
                client.networking_messages.allowPeer(peer.steamId64)
            }
        })
    }
    allowMembers()

    lobbyChatUpdateHandle = client.callback.register(SteamCallback.LobbyChatUpdate, ({ user_changed, member_state_change }) => {
        // member_state_change arrives as the variant name; anything but
        // 'Entered' is a leave, disconnect, kick, or ban.
        if (member_state_change === 'Entered') {
            client.networking_messages.allowPeer(user_changed)
            console.log(`${user_changed} joined`)
        } else {
            client.networking_messages.disallowPeer(user_changed)
            client.networking_messages.closeSessionWithUser(user_changed)
            console.log(`${user_changed} left`)
        }
    })

    const broadcast = (text) => {
        lobby.getMembers().forEach(peer => {
            if (peer.steamId64 !== me) {
                try {
                    client.networking_messages.sendMessageToUser(
                        peer.steamId64,
                        client.networking_messages.MessageSendType.Reliable,
                        Buffer.from(text),
                        CHANNEL,
                    )
                } catch (e) {
                    console.log(`Send to ${peer.steamId64} failed: ${e.message}`)
                }
            }
        })
    }

    // Opening message so the receiving side gets a session request right away.
    broadcast(`${client.localplayer.getName()} connected`)

    let askChatMessage
    askChatMessage = () => {
        rlInterface.question(client.localplayer.getName() + ': ', line => {
            if (line.startsWith('/invite ')) {
                try {
                    const target = BigInt(line.slice('/invite '.length).trim())
                    console.log(`inviteUser(${target}): ${lobby.inviteUser(target)}`)
                } catch (e) {
                    console.log(`usage: /invite <steamId64> (${e.message})`)
                }
            } else if (line === '/friends') {
                client.friends.getFriends().forEach(f => console.log(`  ${f.name} ${f.steamId.steamId64} state=${f.state}${f.playingAppId ? ` app=${f.playingAppId}` : ''}`))
            } else if (line === '/info') {
                lobby.getMembers().forEach(peer => {
                    if (peer.steamId64 !== me) {
                        console.log(peer.steamId64, client.networking_messages.getSessionConnectionInfo(peer.steamId64))
                    }
                })
            } else {
                broadcast(client.localplayer.getName() + ': ' + line)
            }
            askChatMessage()
        })
    }
    askChatMessage()

    // Received messages are polled, not delivered by callback.
    setInterval(() => {
        for (const { steamId, data } of client.networking_messages.receiveMessagesOnChannel(CHANNEL, 32)) {
            if (steamId.steamId64 !== me) {
                console.log(data.toString() + '\n')
            }
        }
    }, 66);
})
