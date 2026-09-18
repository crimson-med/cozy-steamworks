// Screenshots check. Requires a running, logged-in Steam client.
//
//   node test/screenshots.js
//
// Uses app 480 (Spacewar). Always checks that bad paths and a bogus handle
// are refused without throwing. SCREENSHOT_UPLOAD=1 additionally adds a
// generated PNG to the real Steam screenshot library, waits for
// ScreenshotReady, then sets a location and tags the local user on it.
// Exit code 1 if anything fails.

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { init, SteamCallback } = require('../index.js')

let failures = 0
const check = (ok, what, detail) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`)
    if (!ok) failures++
}
const skip = (what, detail) => console.log(`  skip  ${what}${detail ? `  (${detail})` : ''}`)
const noThrow = (fn) => { try { return { value: fn() } } catch (e) { return { error: e } } }

// Minimal truecolor PNG of a vertical gradient, so no image dependency.
function writePng(file, width, height) {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        return c >>> 0
    })
    const crc = (buf) => {
        let c = 0xffffffff
        for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
        return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
        const sum = Buffer.alloc(4)
        sum.writeUInt32BE(crc(body))
        return Buffer.concat([len, body, sum])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // truecolor
    const raw = Buffer.alloc((width * 3 + 1) * height)
    for (let y = 0; y < height; y++) {
        const row = y * (width * 3 + 1)
        for (let x = 0; x < width; x++) {
            raw[row + 1 + x * 3] = 40
            raw[row + 2 + x * 3] = Math.round(120 + 100 * y / height)
            raw[row + 3 + x * 3] = 200
        }
    }
    fs.writeFileSync(file, Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]))
}

async function main() {
    const client = init(480)
    const { screenshots } = client
    const me = client.localplayer.getSteamId().steamId64

    const rel = noThrow(() => screenshots.addToLibrary('cozy-relative.png', 64, 64))
    check(!rel.error && rel.value === null, 'addToLibrary() with a relative path returns null', rel.error?.message)

    const missingPath = path.join(os.tmpdir(), `cozy-missing-${Date.now()}.png`)
    const missing = noThrow(() => screenshots.addToLibrary(missingPath, 64, 64))
    check(!missing.error && missing.value === null, 'addToLibrary() with a missing file returns null', missing.error?.message)

    const nul = noThrow(() => screenshots.addToLibrary(path.join(os.tmpdir(), 'cozy\0shot.png'), 64, 64))
    check(!nul.error && nul.value === null, 'addToLibrary() with a NUL in the path returns null', nul.error?.message)

    const bogus = noThrow(() => screenshots.setLocation(0xfffffff0, 'Deep Sea'))
    check(!bogus.error && bogus.value === false, 'setLocation() on a bogus handle returns false', bogus.error?.message ?? String(bogus.value))

    const nulLoc = noThrow(() => screenshots.setLocation(0xfffffff0, 'Deep\0Sea'))
    check(!nulLoc.error && nulLoc.value === false, 'setLocation() with a NUL in the location returns false', nulLoc.error?.message)

    // Writes to the real Steam screenshot library of the logged-in account,
    // so it is opt in. Set SCREENSHOT_UPLOAD=1 to run it.
    if (!process.env.SCREENSHOT_UPLOAD) {
        skip('addToLibrary() + ScreenshotReady + setLocation + tagUser', 'set SCREENSHOT_UPLOAD=1 to add a real screenshot')
        return
    }

    const file = path.join(os.tmpdir(), `cozy-screenshot-${Date.now()}.png`)
    const width = 320
    const height = 180
    writePng(file, width, height)

    const readyEvents = []
    let onReady
    const handle = client.callback.register(SteamCallback.ScreenshotReady, (value) => {
        readyEvents.push(value)
        if (onReady) onReady()
    })

    try {
        const h = screenshots.addToLibrary(file, width, height)
        check(typeof h === 'number', 'addToLibrary() with a real PNG returns a number', String(h))
        if (typeof h !== 'number') return

        const ready = await new Promise((resolve) => {
            const find = () => readyEvents.find(e => e.handle === h)
            const timer = setTimeout(() => resolve(find()), 15000)
            onReady = () => { const e = find(); if (e) { clearTimeout(timer); resolve(e) } }
            onReady()
        })
        check(ready !== undefined, 'ScreenshotReady arrived for that handle', ready ? JSON.stringify(ready) : 'nothing within 15s')
        if (!ready) return
        check(ready.result === 1, 'ScreenshotReady result is 1 (k_EResultOK)', String(ready.result))

        const loc = screenshots.setLocation(h, 'Deep Sea')
        check(loc === true, "setLocation(h, 'Deep Sea') returns true", String(loc))

        const tagged = screenshots.tagUser(h, me)
        check(tagged === true, 'tagUser(h, self) returns true', String(tagged))
    } finally {
        handle.disconnect()
        fs.rmSync(file, { force: true })
    }
}

main()
    .catch(e => { check(false, 'unexpected error', e.stack || e.message) })
    .finally(() => {
        console.log(`\n${failures ? `${failures} failed` : 'all passed'}`)
        process.exit(failures ? 1 : 0)
    })
