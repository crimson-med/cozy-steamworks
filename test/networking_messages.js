// Two-machine chat over ISteamNetworkingMessages.
//
// Machine A: run with no argument, note the printed lobby id.
// Machine B: run and paste that lobby id when prompted.
// Both then type lines; each line is sent Reliable on channel 0 to every
// other lobby member and printed on receipt.

const rl = require('readline');
const { init, SteamCallback } = require('../index.js')

const CHANNEL = 0

const client = init(480)
const me = client.localplayer.getSteamId().steamId64

// Sessions are accepted synchronously in Rust against an allow list, so the
// host must allow a peer before that peer's first message can be accepted.
client.networking_messages.initSessionCallbacks(
    (steamId64, accepted) => console.log(`Session request from ${steamId64}: ${accepted ? 'accepted' : 'rejected'}`),
    (steamId64) => console.log(`Session with ${steamId64} failed:`, client.networking_messages.getSessionConnectionInfo(steamId64)),
)

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

    client.callback.register(SteamCallback.LobbyChatUpdate, ({ user_changed, member_state_change }) => {
        // ChatMemberStateChange.Entered is 0; anything else is a leave/kick/ban.
        if (member_state_change === 0) {
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
                client.networking_messages.sendMessageToUser(
                    peer.steamId64,
                    client.networking_messages.MessageSendType.Reliable,
                    Buffer.from(text),
                    CHANNEL,
                )
            }
        })
    }

    // Opening message so the receiving side gets a session request right away.
    broadcast(`${client.localplayer.getName()} connected`)

    let askChatMessage
    askChatMessage = () => {
        rlInterface.question(client.localplayer.getName() + ': ', line => {
            if (line === '/info') {
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
