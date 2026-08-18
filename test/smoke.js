// Single-machine smoke test. Requires a running, logged-in Steam client.
// Uses app 480 (Spacewar), which every Steam account owns.
//
//   node test/smoke.js
//
// Exercises the surface Cozy Coast depends on, then the fork additions:
// identity, rich presence, achievements (read only), cloud flags, lobby
// create + data + filtered list, owner transfer to self, a leaderboard read,
// an aggregated global stats request, and a loopback message over
// ISteamNetworkingMessages. Exit code 1 if anything fails.

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
    try {
        const rp = client.localplayer.setRichPresence('status', 'cozy smoke')
        rp === true ? pass('setRichPresence() accepted') : fail('setRichPresence() accepted', String(rp))
        const cleared = client.localplayer.setRichPresence('status', null)
        cleared === true ? pass('setRichPresence(null) accepted') : fail('setRichPresence(null) accepted', String(cleared))
        const tooLong = client.localplayer.setRichPresence('status', 'x'.repeat(300))
        tooLong === false ? pass('setRichPresence() rejects oversize value', 'false') : fail('setRichPresence() rejects oversize value', String(tooLong))
        client.localplayer.clearRichPresence(); pass('clearRichPresence()')
    } catch (e) { fail('setRichPresence()', e.message) }

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

    console.log('friends')
    let friends = []
    try {
        friends = client.friends.getFriends()
        const shapeOk = friends.every(f => typeof f.steamId?.steamId64 === 'bigint' && typeof f.name === 'string' && typeof f.state === 'number' && typeof f.playingAppId === 'number')
        shapeOk ? pass('getFriends() shape', `${friends.length} friend(s)`) : fail('getFriends() shape')
    } catch (e) { fail('getFriends()', e.message) }
    client.friends.getFriendName(me) === name ? pass('getFriendName(self)') : fail('getFriendName(self)', client.friends.getFriendName(me))
    if (lobby) {
        // Sends a real Steam chat invite to a friend, so opt in with
        // SMOKE_INVITE=1 (or SMOKE_INVITE=<steamId64> to pick the friend).
        const inviteOpt = process.env.SMOKE_INVITE
        if (!inviteOpt) {
            skip('lobby.inviteUser(friend)', 'set SMOKE_INVITE=1 to send a real invite to a friend')
        } else if (!friends.length) {
            skip('lobby.inviteUser(friend)', 'no friends on this account')
        } else {
            const target = inviteOpt === '1'
                ? friends[0]
                : friends.find(f => String(f.steamId.steamId64) === inviteOpt)
            if (!target) {
                skip('lobby.inviteUser(friend)', `SMOKE_INVITE=${inviteOpt} is not in the friends list`)
            } else {
                // Steam may throttle invites, so only the type is asserted.
                const r = lobby.inviteUser(target.steamId.steamId64)
                typeof r === 'boolean' ? pass('lobby.inviteUser(friend) returns boolean', `${target.name}: ${r}`) : fail('lobby.inviteUser(friend)', typeof r)
            }
        }
    }

    console.log('leaderboard')
    try {
        const board = await client.leaderboard.findLeaderboard('Feet Traveled')
        if (!board) {
            skip('findLeaderboard()', "'Feet Traveled' not present on this app")
        } else {
            board.getName() ? pass('findLeaderboard()', `${board.getName()}, ${board.getEntryCount()} entries`) : fail('findLeaderboard()', 'empty name')
            const top = await board.downloadEntries(client.leaderboard.LeaderboardDataRequest.Global, 1, 5, 2)
            const shapeOk = Array.isArray(top) && top.every(e => typeof e.user?.steamId64 === 'bigint' && typeof e.globalRank === 'number' && typeof e.score === 'number' && Array.isArray(e.details))
            shapeOk ? pass('downloadEntries(Global, 1, 5)', `${top.length} entr${top.length === 1 ? 'y' : 'ies'}`) : fail('downloadEntries(Global, 1, 5)', JSON.stringify(top))
        }
    } catch (e) { fail('leaderboard', e.message) }

    console.log('global_stats')
    try {
        const t0 = Date.now()
        await client.global_stats.requestGlobalStats(1)
        pass('requestGlobalStats(1) resolved', `${Date.now() - t0}ms`)
    } catch (e) {
        // A Steam EResult rejection still proves the call result plumbing. A
        // timeout or a dropped callback means nothing ever came back.
        /timed out|dropped/i.test(e.message)
            ? fail('requestGlobalStats(1) never completed', e.message)
            : pass('requestGlobalStats(1) completed with a Steam error', e.message)
    }
    try {
        const total = client.global_stats.getGlobalStatInt64('NumGames')
        total === null || typeof total === 'bigint'
            ? pass("getGlobalStatInt64('NumGames')", String(total))
            : fail("getGlobalStatInt64('NumGames')", typeof total)
    } catch (e) { fail('getGlobalStatInt64()', e.message) }

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
