// Friends list check. Requires a running, logged-in Steam client.
//
//   node test/friends.js
//
// Prints the immediate friends list and verifies the shape of each entry.
// Exit code 1 if anything fails.

const { init } = require('../index.js')

let failures = 0
const check = (ok, what) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`)
    if (!ok) failures++
}

const client = init(480)
const me = client.localplayer.getSteamId().steamId64

const friends = client.friends.getFriends()
check(Array.isArray(friends), `getFriends() returns an array (${friends.length} friend(s))`)

let allShapesOk = true
for (const f of friends) {
    const shapeOk = typeof f.steamId?.steamId64 === 'bigint'
        && typeof f.name === 'string'
        && typeof f.state === 'number'
        && typeof f.playingAppId === 'number'
    if (!shapeOk) {
        allShapesOk = false
        console.log(`        bad entry: ${JSON.stringify(f, (_, v) => typeof v === 'bigint' ? String(v) : v)}`)
    }
}
check(allShapesOk, 'every friend entry has steamId.steamId64 bigint, name string, state number, playingAppId number')

const stateName = Object.fromEntries(Object.entries(client.friends.FriendState).map(([k, v]) => [v, k]))
for (const f of friends.slice(0, 20)) {
    console.log(`        ${f.name} (${f.steamId.steamId64}) ${stateName[f.state]}${f.playingAppId ? ` in app ${f.playingAppId}` : ''}`)
}
if (friends.length > 20) console.log(`        ... ${friends.length - 20} more`)

check(client.friends.getFriendName(me) === client.localplayer.getName(), 'getFriendName(self) equals localplayer.getName()')
check(typeof client.friends.requestUserInformation(me, true) === 'boolean', 'requestUserInformation(self) returns boolean')

let threw = false
try { client.friends.inviteUserToGame(me, 'bad\0connect') } catch (e) { threw = true }
check(threw, 'inviteUserToGame rejects a NUL byte in the connect string')

console.log(`\n${failures ? `${failures} failed` : 'all passed'}`)
process.exit(failures ? 1 : 0)
