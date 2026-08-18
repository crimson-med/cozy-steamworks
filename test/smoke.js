// Single-machine smoke test. Requires a running, logged-in Steam client.
// Uses app 480 (Spacewar), which every Steam account owns.
//
//   node test/smoke.js
//
// Exercises the surface Cozy Coast depends on, then the fork additions:
// identity, rich presence, achievements (read only), cloud flags, lobby
// create + data + filtered list, owner transfer to self, and a loopback
// message over ISteamNetworkingMessages. Exit code 1 if anything fails.

const steamworks = require('../index.js')

const results = []
const pass = (name, detail) => { results.push({ ok: true, name, detail }); console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`) }
const fail = (name, detail) => { results.push({ ok: false, name, detail }); console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`) }
const skip = (name, detail) => { results.push({ ok: true, name, detail, skipped: true }); console.log(`  skip  ${name}${detail ? `  (${detail})` : ''}`) }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function pollUntil(fn, timeoutMs, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const value = fn()
        if (value) return value
        if (Date.now() > deadline) return undefined
        await sleep(intervalMs)
    }
}

async function main() {
    console.log('init')
    let client
    try {
        client = steamworks.init(480)
        pass('init(480)')
    } catch (e) {
        fail('init(480)', e.message)
        return
    }

    typeof steamworks.runCallbacks === 'function' ? pass('runCallbacks exported') : fail('runCallbacks exported')

    console.log('localplayer')
    const id = client.localplayer.getSteamId()
    typeof id.steamId64 === 'bigint' && id.steamId64 > 0n
        ? pass('getSteamId()', `${id.steamId64} / ${id.steamId32} / ${id.accountId}`)
        : fail('getSteamId()', JSON.stringify(id))
    const me = id.steamId64
    const name = client.localplayer.getName()
    name ? pass('getName()', name) : fail('getName()')
    try { client.localplayer.setRichPresence('status', 'cozy smoke'); pass('setRichPresence()') } catch (e) { fail('setRichPresence()', e.message) }

    console.log('achievement / cloud / overlay')
    try {
        const v = client.achievement.isActivated('ACH_WIN_ONE_GAME')
        typeof v === 'boolean' ? pass('achievement.isActivated()', String(v)) : fail('achievement.isActivated()', typeof v)
    } catch (e) { fail('achievement.isActivated()', e.message) }
    try {
        pass('cloud flags', `account=${client.cloud.isEnabledForAccount()} app=${client.cloud.isEnabledForApp()}`)
    } catch (e) { fail('cloud flags', e.message) }
    typeof client.overlay.activateDialog === 'function' ? pass('overlay.activateDialog present') : fail('overlay.activateDialog present')

    console.log('matchmaking')
    const nonce = `smoke-${Date.now()}`
    let lobby
    try {
        lobby = await client.matchmaking.createLobby(client.matchmaking.LobbyType.Public, 4)
        pass('createLobby()', String(lobby.id))
    } catch (e) {
        fail('createLobby()', e.message)
    }

    if (lobby) {
        lobby.setData('cozy_smoke', nonce) ? pass('setData()') : fail('setData()')
        lobby.getData('cozy_smoke') === nonce ? pass('getData()') : fail('getData()', lobby.getData('cozy_smoke'))
        lobby.getOwner().steamId64 === me ? pass('getOwner() is self') : fail('getOwner() is self', String(lobby.getOwner().steamId64))
        lobby.getMemberCount() >= 1n ? pass('getMemberCount()', String(lobby.getMemberCount())) : fail('getMemberCount()')

        // Lobby data propagates to the backend asynchronously; retry the
        // filtered list for a few seconds.
        let found
        const deadline = Date.now() + 8000
        let attempts = 0
        while (!found && Date.now() < deadline) {
            attempts++
            try {
                const lobbies = await client.matchmaking.getLobbies({
                    stringFilters: [{ key: 'cozy_smoke', value: nonce, comparison: client.matchmaking.LobbyComparison.Equal }],
                    distance: client.matchmaking.LobbyDistanceFilter.Worldwide,
                    resultCount: 10,
                })
                found = lobbies.find(l => l.id === lobby.id)
            } catch (e) {
                fail('getLobbies(filter)', e.message)
                break
            }
            if (!found) await sleep(500)
        }
        found ? pass('getLobbies(filter) finds own lobby', `${attempts} attempt(s)`) : fail('getLobbies(filter) finds own lobby', `not found after ${attempts} attempt(s)`)

        try {
            const missing = await client.matchmaking.getLobbies({
                stringFilters: [{ key: 'cozy_smoke', value: `${nonce}-nope`, comparison: client.matchmaking.LobbyComparison.Equal }],
                distance: client.matchmaking.LobbyDistanceFilter.Worldwide,
            })
            missing.some(l => l.id === lobby.id) ? fail('getLobbies(filter) excludes mismatch') : pass('getLobbies(filter) excludes mismatch', `${missing.length} other result(s)`)
        } catch (e) { fail('getLobbies(filter) excludes mismatch', e.message) }

        try {
            await client.matchmaking.getLobbies({ stringFilters: [{ key: 'bad\0key', value: 'x', comparison: 2 }] })
            fail('getLobbies rejects NUL key')
        } catch (e) { pass('getLobbies rejects NUL key', e.message) }

        lobby.setOwner(me) ? pass('setOwner(self)') : fail('setOwner(self)')
    }

    console.log('networking_messages')
    const nm = client.networking_messages
    const CHANNEL = 7
    let requestSeen
    try {
        nm.initSessionCallbacks(
            (steamId64, accepted) => { requestSeen = { steamId64, accepted } },
            (steamId64) => { console.log(`  note  session failed with ${steamId64}`); nm.closeSessionWithUser(steamId64) },
        )
        pass('initSessionCallbacks()')
    } catch (e) { fail('initSessionCallbacks()', e.message) }

    nm.isPeerAllowed(me) === false ? pass('isPeerAllowed default false') : fail('isPeerAllowed default false')
    nm.allowPeer(me)
    nm.isPeerAllowed(me) ? pass('allowPeer()') : fail('allowPeer()')

    const before = nm.getSessionConnectionInfo(me)
    before.state === nm.SessionConnectionState.None ? pass('getSessionConnectionInfo() no session', 'state None') : fail('getSessionConnectionInfo() no session', JSON.stringify(before))

    let loopbackOk = false
    try {
        nm.sendMessageToUser(me, nm.MessageSendType.Reliable, Buffer.from('ping'), CHANNEL)
        pass('sendMessageToUser(self)')
        const got = await pollUntil(() => {
            const msgs = nm.receiveMessagesOnChannel(CHANNEL, 8)
            return msgs.find(m => m.data.toString() === 'ping')
        }, 5000)
        if (got) {
            loopbackOk = true
            pass('receiveMessagesOnChannel() loopback', `from ${got.steamId.steamId64} channel ${got.channel} size ${got.size}`)
        } else {
            skip('receiveMessagesOnChannel() loopback', 'no message within 5s; Steam may not loop back to self, verify with two machines')
        }
    } catch (e) {
        skip('sendMessageToUser(self)', `threw ${e.message}; Steam may not loop back to self, verify with two machines`)
    }

    if (loopbackOk) {
        const info = nm.getSessionConnectionInfo(me)
        console.log('  info ', JSON.stringify(info))
        info.state !== nm.SessionConnectionState.None ? pass('getSessionConnectionInfo() with session') : fail('getSessionConnectionInfo() with session', JSON.stringify(info))
        requestSeen ? pass('onSessionRequest fired', JSON.stringify(requestSeen, (_, v) => typeof v === 'bigint' ? String(v) : v)) : skip('onSessionRequest fired', 'not observed for loopback')
    }
    const closed = nm.closeSessionWithUser(me)
    if (loopbackOk) closed ? pass('closeSessionWithUser() true') : fail('closeSessionWithUser() true', String(closed))
    else typeof closed === 'boolean' ? pass('closeSessionWithUser()') : fail('closeSessionWithUser()')
    nm.disallowPeer(me)
    !nm.isPeerAllowed(me) ? pass('disallowPeer()') : fail('disallowPeer()')

    if (lobby) {
        try { lobby.leave(); pass('lobby.leave()') } catch (e) { fail('lobby.leave()', e.message) }
    }
}

main().then(() => {
    const failed = results.filter(r => !r.ok)
    const skipped = results.filter(r => r.skipped)
    console.log(`\n${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`)
    process.exit(failed.length ? 1 : 0)
}).catch(e => {
    console.error(e)
    process.exit(1)
})
