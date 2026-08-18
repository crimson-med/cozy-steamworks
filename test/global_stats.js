// Global stats check. Requires a running, logged-in Steam client.
//
//   node test/global_stats.js
//
// Uses app 480 (Spacewar), which has aggregated global stats configured.
// Verifies that the request completes rather than hanging, and that the
// getters return the documented types. Exit code 1 if anything fails.

const { init } = require('../index.js')

let failures = 0
const check = (ok, what, detail) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`)
    if (!ok) failures++
}
const json = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x)

async function main() {
    const { global_stats: globalStats } = init(480)

    const started = Date.now()
    let requested = false
    try {
        // The Rust side already gives up after 15s, but index.js keeps a 30Hz
        // interval alive, so a promise that never settles would wedge this
        // process instead of failing. Race a rejecting timer as a backstop.
        await Promise.race([
            globalStats.requestGlobalStats(7),
            new Promise((_, reject) => {
                const timer = setTimeout(() => reject(new Error('hung: no settle within 20s')), 20000)
                timer.unref?.()
            }),
        ])
        requested = true
        check(true, 'requestGlobalStats(7) resolved', `${Date.now() - started}ms`)
    } catch (e) {
        // A Steam-reported failure still proves the call result plumbing. A
        // hang or a dropped callback does not, so those fail.
        const hung = /hung|timed out|dropped/i.test(e.message)
        check(!hung, 'requestGlobalStats(7) completed with a Steam error', e.message)
    }

    const total = globalStats.getGlobalStatInt64('NumGames')
    check(total === null || typeof total === 'bigint', "getGlobalStatInt64('NumGames') returns bigint or null", json(total))

    const missing = globalStats.getGlobalStatInt64('cozy_not_a_global_stat')
    check(missing === null, 'getGlobalStatInt64() on an unknown stat returns null')

    const asDouble = globalStats.getGlobalStatDouble('NumGames')
    check(asDouble === null || typeof asDouble === 'number', "getGlobalStatDouble('NumGames') returns number or null", json(asDouble))

    const history = globalStats.getGlobalStatHistoryInt64('NumGames', 7)
    const historyOk = Array.isArray(history) && history.every(v => typeof v === 'bigint')
    check(historyOk, "getGlobalStatHistoryInt64('NumGames', 7) returns an array of bigints", `${history.length} day(s) ${json(history)}`)
    check(history.length <= 7, 'history is no longer than the requested day count')

    const zeroDays = globalStats.getGlobalStatHistoryInt64('NumGames', 0)
    check(Array.isArray(zeroDays) && zeroDays.length === 0, 'getGlobalStatHistoryInt64(name, 0) returns an empty array')

    if (requested && total === null) {
        console.log('  ..    NumGames is not aggregated for this app, null and [] above are expected')
    }

    for (const [what, fn] of [
        ['getGlobalStatInt64', () => globalStats.getGlobalStatInt64('bad\0name')],
        ['getGlobalStatDouble', () => globalStats.getGlobalStatDouble('bad\0name')],
        ['getGlobalStatHistoryInt64', () => globalStats.getGlobalStatHistoryInt64('bad\0name', 3)],
    ]) {
        let threw = false
        try { fn() } catch (e) { threw = true }
        check(threw, `${what}() rejects a NUL byte in the name`)
    }
}

main()
    .catch(e => { check(false, 'unexpected error', e.stack || e.message) })
    .finally(() => {
        console.log(`\n${failures ? `${failures} failed` : 'all passed'}`)
        process.exit(failures ? 1 : 0)
    })
