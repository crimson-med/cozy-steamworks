[![Build Status](https://github.com/crimson-med/cozy-steamworks/actions/workflows/publish.yml/badge.svg)](https://github.com/crimson-med/cozy-steamworks/actions/workflows/publish.yml)
[![Release](https://img.shields.io/github/v/release/crimson-med/cozy-steamworks)](https://github.com/crimson-med/cozy-steamworks/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# @cozycoast/steamworks.js

A fork of [steamworks.js](https://github.com/ceifa/steamworks.js) maintained for [Cozy Coast](https://store.steampowered.com/app/4938190). It tracks a current Steamworks SDK and adds the multiplayer surface the upstream project never exposed. The original README, credits, and license apply; only the differences are documented here.

## Differences from upstream

| Area | Upstream 0.4.0 | This fork |
| --- | --- | --- |
| Rust crate | `steamworks` git rev (0.11.0) | `steamworks` 0.13.1 (Steamworks SDK 1.64) |
| Redistributables | SDK 1.5x (`SteamClient021`) | SDK 1.64 (`SteamClient023`) |
| Networking | `networking` (legacy `ISteamNetworking`, deprecated by Valve) | Both `networking` and a new `networking_messages` (`ISteamNetworkingMessages`) |
| Lobby list | `getLobbies()` unfiltered | `getLobbies(filter?)` with server-side string, number, near-value, open-slot, distance, and result-count filters |
| Lobby owner | read only | `Lobby.setOwner()` |
| Workshop / UGC | `workshop` module | removed |
| `runCallbacks` | internal only | also exported for manual pumping |
| `callbacks.d.ts` | `member_state_change` typed as a number | typed as the variant name string it actually is |
| Friends | none | `friends` namespace: `getFriends`, `getFriendName`, `requestUserInformation`, `inviteUserToGame` |
| Lobby invites | `Lobby.openInviteDialog()` (overlay only) | plus `Lobby.inviteUser(steamId64)` via Steam chat, no overlay needed |
| Callbacks | up to `MicroTxnAuthorizationResponse` | plus `GameRichPresenceJoinRequested` |
| Rich presence | `setRichPresence` returns void | returns Steam's accept/reject bool; `clearRichPresence` added |
| Leaderboards | none | `leaderboard` namespace: find, find-or-create, score upload, and entry download for global, around-user, and friends ranges |
| Global stats | none | `global_stats` namespace: aggregated lifetime totals and day-by-day history for stats marked as aggregated |

`init` no longer calls `RequestCurrentStats`. SDK 1.64 removed it: stats and achievements are synchronized by the Steam client before the game process starts, so nothing replaces it.

## API

```js
const steamworks = require('@cozycoast/steamworks.js')

// You can pass an appId, or don't pass anything and use a steam_appid.txt file
const client = steamworks.init(480)

// Print Steam username
console.log(client.localplayer.getName())

// Tries to activate an achievement
if (client.achievement.activate('ACHIEVEMENT')) {
    // ...
}
```

Refer to [client.d.ts](./client.d.ts) for the full surface and per-function documentation.

### Lobby list filters

```js
const lobbies = await client.matchmaking.getLobbies({
    stringFilters: [{ key: 'protocol', value: '3', comparison: client.matchmaking.LobbyComparison.Equal }],
    openSlots: 1,
    distance: client.matchmaking.LobbyDistanceFilter.Worldwide,
    resultCount: 50,
})
```

Filters apply to the request they are passed with and do not persist.

### Networking messages

`ISteamNetworkingMessages` is connectionless: you send to a Steam ID and Steam opens a session on demand. Sessions are accepted or rejected synchronously inside a Steam callback, which cannot round-trip through JavaScript, so the policy is declared up front:

```js
const nm = client.networking_messages

// Register once after init. Both handlers fire on the callback pump.
nm.initSessionCallbacks(
    (steamId64, accepted) => { /* peer requested a session; accepted per policy */ },
    (steamId64) => {
        // Session broke. Acknowledge it before sending to that peer again.
        nm.closeSessionWithUser(steamId64)
    },
)

// Allow peers as they join your lobby, revoke as they leave.
client.callback.register(steamworks.SteamCallback.LobbyChatUpdate, ({ user_changed, member_state_change }) => {
    if (member_state_change === 'Entered') nm.allowPeer(user_changed)
    else nm.disallowPeer(user_changed)
})

// Send. Throws with the EResult name (for example 'NoConnection') on failure.
nm.sendMessageToUser(peerId64, nm.MessageSendType.Unreliable, Buffer.from(payload), 1)

// Receive by polling; messages are not delivered through callbacks.
setInterval(() => {
    for (const { steamId, data, channel } of nm.receiveMessagesOnChannel(1, 32)) {
        // ...
    }
}, 50)
```

`setAllowAllSessions(true)` accepts every incoming session and is intended for private playtests only. `getSessionConnectionInfo(steamId64)` reports the session state, ping, delivery quality, and whether the route is relayed.

### Leaderboards

Leaderboard handles are only valid for the current Steam session, so look one up by name each run rather than storing its id.

```js
const lb = client.leaderboard
const board = await lb.findLeaderboard('Feet Traveled')
// or create it on first use:
// const board = await lb.findOrCreateLeaderboard('speedrun', lb.LeaderboardSortMethod.Ascending, lb.LeaderboardDisplayType.TimeMilliSeconds)

await board.uploadScore(lb.UploadScoreMethod.KeepBest, 4200, [level, seed])

// Absolute 1 based ranks.
const top10 = await board.downloadEntries(lb.LeaderboardDataRequest.Global, 1, 10, 2)
// Offsets relative to your own rank, so this is your row plus four above and five below.
const around = await board.downloadEntries(lb.LeaderboardDataRequest.GlobalAroundUser, -4, 5, 2)
const friends = await board.downloadEntries(lb.LeaderboardDataRequest.Friends, 0, 0)
```

`details` is an optional payload of at most 64 ints stored with the score, and is only read back when a non-zero `maxDetails` is passed to `downloadEntries`. Steam rate limits uploads to roughly 10 per 10 minutes per user.

### Global stats

Only stats marked as aggregated in the Steamworks App Admin are readable here. Steam starts aggregating from the moment that is switched on and the totals trail live play by roughly a day, so this is not real time data.

```js
// Totals, plus seven days of day-by-day history. Resolve before reading.
await client.global_stats.requestGlobalStats(7)

const total = client.global_stats.getGlobalStatInt64('NumGames')     // bigint or null
const rate = client.global_stats.getGlobalStatDouble('Distance')     // number or null
const daily = client.global_stats.getGlobalStatHistoryInt64('NumGames', 7)  // index 0 is today
```

The getters return `null` and `[]` until the request resolves, and keep returning them when the stat is not aggregated for the app.

## Installation

Releases are published as tarballs on [GitHub Releases](https://github.com/crimson-med/cozy-steamworks/releases), not on npm. Install by URL:

```sh
npm i https://github.com/crimson-med/cozy-steamworks/releases/download/v0.7.0/cozycoast-steamworks.js-0.7.0.tgz
```

or in `package.json`:

```json
"@cozycoast/steamworks.js": "https://github.com/crimson-med/cozy-steamworks/releases/download/v0.7.0/cozycoast-steamworks.js-0.7.0.tgz"
```

The prebuilt binaries in `dist/` are only present in the tarball, not in the repository, so a plain git dependency does not work.

### Electron

The native module cannot be used by default in the renderer process. Keep all Steam calls in the main process and expose what the renderer needs through your own IPC bridge. If you must load it in the renderer, upstream documents enabling `nodeIntegration` and disabling `contextIsolation`, which weakens the renderer sandbox.

To make the Steam overlay work, call `electronEnableSteamOverlay` at the end of your `main.js`:

```js
require('@cozycoast/steamworks.js').electronEnableSteamOverlay()
```

For the production build, copy the relevant distro files from `sdk/redistributable_bin/{YOUR_DISTRO}` into the root of your build, and keep the package outside the asar archive.

## How to build

> You only need to build if you are changing the library. To consume it, install a release tarball.

Requirements: current [Node.js](https://nodejs.org/en/), [Rust](https://www.rust-lang.org/tools/install), and [Clang](https://rust-lang.github.io/rust-bindgen/requirements.html). Steam must be installed and running to exercise anything beyond compilation.

```sh
npm ci
npm run build          # release build for the current target, regenerates client.d.ts
npm run build:debug
```

CI builds `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `x86_64-apple-darwin`, and `aarch64-apple-darwin` on every push to `main` and every pull request. A GitHub Release with the packed tarball is created only for a `v*` tag matching `package.json`, or a manual workflow dispatch.

To cut a release: bump `version` in `package.json` and `package-lock.json`, merge to `main`, then push a `vX.Y.Z` tag.

### Testing

- `node test/smoke.js` runs a single-machine check against a running Steam client (app 480): identity, lobby create and filtered list, self-owner transfer, friends list, leaderboard read, global stats request, loopback message. `SMOKE_INVITE=1` additionally sends a real lobby invite to your first friend.
- `node test/friends.js` prints the friends list and checks its shape.
- `node test/leaderboard.js` exercises the leaderboard surface against the Spacewar sample board. `LEADERBOARD_UPLOAD=1` additionally writes a real score, which counts against Steam's roughly 10 uploads per 10 minutes per user.
- `node test/global_stats.js` requests aggregated global stats and checks the getter return types.
- `node test/networking_messages.js` on two machines exercises a real peer session.
- `test/electron` runs the upstream Electron overlay test.

## Upstream

Bug reports and general questions about the API belong with [ceifa/steamworks.js](https://github.com/ceifa/steamworks.js). This fork tracks that repository as `upstream`.
