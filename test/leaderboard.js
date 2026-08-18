// Leaderboard check. Requires a running, logged-in Steam client.
//
//   node test/leaderboard.js
//
// Uses app 480 (Spacewar). Finds the sample "Feet Traveled" leaderboard, or
// creates a scratch one if it is not present, then exercises the getters and
// every download mode. LEADERBOARD_UPLOAD=1 additionally writes a real score.
// Exit code 1 if anything fails.

const { init } = require('../index.js')

let failures = 0
const check = (ok, what, detail) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`)
    if (!ok) failures++
}
const skip = (what, detail) => console.log(`  skip  ${what}${detail ? `  (${detail})` : ''}`)
const json = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x)

async function main() {
    const client = init(480)
    const { leaderboard } = client
    const me = client.localplayer.getSteamId().steamId64

    let board = await leaderboard.findLeaderboard('Feet Traveled')
    if (board) {
        check(true, "findLeaderboard('Feet Traveled') found the Spacewar sample board")
    } else {
        console.log("  ..    findLeaderboard('Feet Traveled') returned null, creating a scratch board")
        board = await leaderboard.findOrCreateLeaderboard(
            'cozy_smoke_board',
            leaderboard.LeaderboardSortMethod.Descending,
            leaderboard.LeaderboardDisplayType.Numeric,
        )
        check(board !== null, 'findOrCreateLeaderboard() returned a board')
        if (!board) return
    }

    check(typeof board.id === 'bigint' && board.id > 0n, 'id is a non-zero bigint', String(board.id))

    const name = board.getName()
    check(typeof name === 'string' && name.length > 0, 'getName() returns a non-empty string', name)

    const count = board.getEntryCount()
    check(typeof count === 'number' && count >= 0, 'getEntryCount() returns a non-negative number', String(count))

    const sort = board.getSortMethod()
    const sortNames = Object.fromEntries(Object.entries(leaderboard.LeaderboardSortMethod).map(([k, v]) => [v, k]))
    check(sort !== null && sortNames[sort] !== undefined, 'getSortMethod() returns a known sort method', sortNames[sort])

    const display = board.getDisplayType()
    const displayNames = Object.fromEntries(Object.entries(leaderboard.LeaderboardDisplayType).map(([k, v]) => [v, k]))
    check(display !== null && displayNames[display] !== undefined, 'getDisplayType() returns a known display type', displayNames[display])

    const missing = await leaderboard.findLeaderboard('cozy_definitely_not_a_board_' + Date.now())
    check(missing === null, 'findLeaderboard() on an unknown name resolves to null')

    let threw = false
    try { await leaderboard.findLeaderboard('bad\0name') } catch (e) { threw = true }
    check(threw, 'findLeaderboard() rejects a NUL byte in the name')

    // Steam refuses an over-long name with k_uAPICallInvalid, which the crate
    // registers a callback against and never resolves, so it is caught first.
    let threwLong = false
    try { await leaderboard.findLeaderboard('x'.repeat(129)) } catch (e) { threwLong = true }
    check(threwLong, 'findLeaderboard() rejects a name longer than 128 bytes')

    let threwEmpty = false
    try { await leaderboard.findLeaderboard('') } catch (e) { threwEmpty = true }
    check(threwEmpty, 'findLeaderboard() rejects an empty name')

    // A real upload against Steam's roughly 10 per 10 minutes limit, so it is
    // opt in. Set LEADERBOARD_UPLOAD=1 to write a score to the live board.
    const score = 1000 + (Date.now() % 1000)
    if (!process.env.LEADERBOARD_UPLOAD) {
        skip('uploadScore()', 'set LEADERBOARD_UPLOAD=1 to write a real score')
    } else {
        try {
            const uploaded = await board.uploadScore(leaderboard.UploadScoreMethod.KeepBest, score, [1, 2])
            if (uploaded === null) {
                // Steam reports a throttled upload as unsuccessful rather than
                // as an error, so this is not a binding failure.
                skip('uploadScore()', 'Steam reported the upload as unsuccessful, most likely the ~10 per 10 minutes rate limit')
            } else {
                const shapeOk = typeof uploaded.score === 'number'
                    && typeof uploaded.wasChanged === 'boolean'
                    && typeof uploaded.globalRankNew === 'number'
                    && typeof uploaded.globalRankPrevious === 'number'
                check(shapeOk, `uploadScore(KeepBest, ${score}, [1,2]) resolves with the uploaded shape`, json(uploaded))
            }
        } catch (e) {
            check(false, 'uploadScore()', e.message)
        }
    }

    let threwDetails = false
    try { await board.uploadScore(leaderboard.UploadScoreMethod.KeepBest, 1, new Array(65).fill(0)) } catch (e) { threwDetails = true }
    check(threwDetails, 'uploadScore() rejects more than 64 detail ints')

    const entriesOk = (entries, what, detail) => {
        const ok = Array.isArray(entries) && entries.every(e =>
            typeof e.user?.steamId64 === 'bigint'
            && typeof e.globalRank === 'number'
            && typeof e.score === 'number'
            && Array.isArray(e.details))
        check(ok, what, `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${detail ? `, ${detail}` : ''}`)
        return entries
    }

    try {
        const global = await board.downloadEntries(leaderboard.LeaderboardDataRequest.Global, 1, 10, 2)
        entriesOk(global, 'downloadEntries(Global, 1, 10, 2)')
        for (const e of global.slice(0, 10)) {
            console.log(`        #${e.globalRank}  ${e.score}  ${e.user.steamId64}  details=${json(e.details)}`)
        }
    } catch (e) { check(false, 'downloadEntries(Global)', e.message) }

    try {
        const around = await board.downloadEntries(leaderboard.LeaderboardDataRequest.GlobalAroundUser, -4, 5, 2)
        const mine = around.find(e => e.user.steamId64 === me)
        entriesOk(around, 'downloadEntries(GlobalAroundUser, -4, 5, 2)', mine ? `own rank #${mine.globalRank}` : 'own row not in range')
    } catch (e) { check(false, 'downloadEntries(GlobalAroundUser)', e.message) }

    try {
        const friends = await board.downloadEntries(leaderboard.LeaderboardDataRequest.Friends, 0, 0)
        entriesOk(friends, 'downloadEntries(Friends, 0, 0)')
    } catch (e) { check(false, 'downloadEntries(Friends)', e.message) }

    let threwRange = false
    try { await board.downloadEntries(leaderboard.LeaderboardDataRequest.Global, 10, 1) } catch (e) { threwRange = true }
    check(threwRange, 'downloadEntries() rejects a start greater than end')
}

main()
    .catch(e => { check(false, 'unexpected error', e.stack || e.message) })
    .finally(() => {
        console.log(`\n${failures ? `${failures} failed` : 'all passed'}`)
        process.exit(failures ? 1 : 0)
    })
