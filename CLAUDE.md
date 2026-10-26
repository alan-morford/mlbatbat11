# MLB At Bat 11 — webOS Restoration

This project restores **MLB At Bat 11**, MLB Advanced Media's official app for HP's
webOS 3.0.5 (HP TouchPad). Like `cbssports` (a sibling restoration project — see
`../cbssports` for prior art), this app is long since broken: MLB shut down or
changed the backend feeds it originally shipped against, so live data paths are
dead until repointed at current sources.

## Current state

Working restoration at **v1.2.1**, published at
github.com/alan-morford/mlbatbat11 (see `README.md` for the feature list).

- Source lives in `app/extracted/usr/palm/applications/`: the app
  (`com.mlb.atbat2011`), its Luna service (`com.mlb.atbat2011.service`) and
  the package (`com.mlb.atbat2011.package`). The original package files
  (`control.tar.gz`, `data.tar.gz`) are kept in `app/` for reference.
- Build with `./build-ipk.sh` (from WSL). It writes
  `dist/com.mlb.atbat2011_<version>_all.ipk` and injects `packaging/postinst`.
- Every original MLB backend is dead. Data comes from the MLB Stats API and
  ESPN's public API. Video is relayed through MeTube. Live radio plays through
  the service's own GStreamer pipeline after a self-service MLB (Okta) login.
- Confirmed working on-device: Scoreboard, Gameday, Game Summary, Standings,
  News (Readability reader), Teams, Schedule, Videos, live radio and the
  launch-time update check.
- The obsolete first-run Terms and Conditions modal is skipped for everyone
  (`views/Main.js`). The app-menu entry that shows the terms is kept on purpose.
- Orientation: `lib/Orientation.js` locks to landscape on any webOS tablet
  (9.7" TouchPad, TouchPad Go, with or without LunaCE) and follows 180° flips
  but never portrait. Orientation names differ per device and Luna build, and
  the `orientationchange` position is the raw sensor reading. It's calibrated
  at launch, so never hard-code an orientation name. Confirmed on a Go running
  patched LunaCE. The 9.7" TouchPad and a stock-Luna Go are untested.
- Known harmless launch noise: "Uncaught SyntaxError: Unexpected end of
  input" and an `enyo.xhr` NETWORK_ERR. They come from sandbox-blocked file
  loads (`bam.js` asking for `/shared/scripts/bam/bam.validation.js`, and
  Enyo's WebView asking for `/usr/palm/command-resource-handlers.json`). They
  fail in milliseconds and don't slow startup.
- `SportsLogger.ENABLED` is currently `true`. Decide before a public release.

## Hardware / environment (same physical setup as `cbssports`)

- The project directory lives under Windows (`/mnt/c/Users/...`), mounted into WSL.
  Claude runs in WSL; the webOS devkit (`devkit/SDK`, `devkit/PDK` — `.bat`/`.exe`/
  `.dll` tools like `palm-package.bat`, `palm-install.bat`, `novacom.exe`) is
  Windows-only tooling.
- The physical **HP TouchPad is USB-attached to the user's Windows host**, not WSL.
  Shell out to devkit tools via `powershell.exe -Command "& '<path>' <args>"` —
  this reaches the same USB/novacom context as anything else on that Windows host.
  **Avoid `cmd.exe /c` with quoted paths** — it's been unreliable with quoting
  through the WSL→Windows interop path even for simple commands; `powershell.exe
  -Command` with single-quoted paths has been the reliable default.
- **The user's TouchPad has been patched to support TLS 1.3.** This matters
  because MLB's current APIs are HTTPS-only and old webOS 3.0.5 WebKit/networking
  would otherwise be unable to complete modern TLS handshakes at all — this patch
  is what makes hitting live HTTPS endpoints from the device (rather than just
  from Claude's dev-time testing) feasible in the first place. Don't assume this
  TLS capability exists on a stock/unpatched TouchPad.
- Claude can reach the device over novacom from WSL. Use
  `/mnt/c/Program Files (x86)/HP webOS/SDK/bin/novacom.exe run file:///bin/sh`
  with a script on stdin for shell commands and log reads
  (`/var/log/messages`; app `console.log`/`SportsLogger` lines appear there).
  `palm-install.bat`/`palm-launch.bat` (under `cbssports/devkit/SDK/bin`) also
  work through `powershell.exe`. Install builds when the user asks; otherwise
  hand them off. Use `palm-install -r` before reinstalling so a stale instance
  can't mask a change. Only one novacom session can run at a time, so never
  leave one running in the background.
- No emulator use by default (the user prefers real hardware; ask first). The
  user still reports what's on screen, since there's no way to capture it.
  Verify data-layer logic with a Node.js harness that shims the minimal
  `enyo.kind`/Mojo surface and loads real, unmodified app source.
- Test devices include a **TouchPad Go running LunaCE**, with a local patch to
  LunaCE's orientation remap (see `../rotation`).
- **Be economical with calls to free/undocumented APIs during development** —
  batch checks, cache responses to a local file and re-derive from that instead
  of re-querying, don't re-fetch "just to double-check" once a shape is confirmed.
- Package builds using whatever version is already set in `appinfo.json`/
  `packageinfo.json` — **do not auto-bump the version** on routine builds. Only
  change it if explicitly asked, or if answering a question requires picking a
  new one (ask first).

## MLB data sources (learned from the `cbssports` restoration)

**MLB Stats API** — `https://statsapi.mlb.com/api/v1/` — free, no API key, no
observed rate limit; the actual feed MLB.com itself runs on. Unofficial/
undocumented — verify any recalled field or endpoint still exists before
relying on it again, it could change.

- **Schedule/scores**: `schedule?sportId=1&hydrate=team,linescore&date=YYYY-MM-DD`
  → `dates[0].games[]`. Each game has `teams.home/away.team.{id,name,abbreviation,
  locationName,teamName}`, `teams.home/away.leagueRecord.{wins,losses,ties,pct}`,
  `status.{abstractGameState,detailedState}`, `gameDate` (ISO8601 UTC, directly
  parseable), `linescore.{currentInning,inningState,balls,strikes,outs,
  offense.{first,second,third}}` (base occupancy only present for in-progress
  games).
- **Standings**: `standings?leagueId=103,104&season=YYYY` (103=AL, 104=NL) →
  `records[].teamRecords[]`, each with `team.{id,name}` (⚠ **short** name here,
  e.g. "Rays" not "Tampa Bay Rays" — differs from the schedule endpoint's full
  name), `wins`, `losses`, `winningPercentage` (string like ".583").
- **Full team list**: `teams?sportId=1&activeStatus=Y` → 30 teams with `id`,
  `name` (full), `abbreviation`, `locationName` (⚠ literal home city, e.g.
  "Bronx"/"St. Petersburg"/"Denver"/"Anaheim"/"Phoenix" — **not** the popular
  team-branding city), `teamName` (nickname; abbreviated for Diamondbacks:
  "D-backs"). To get the correct branding location ("Tampa Bay", "New York",
  "Colorado", "Los Angeles", "Arizona"), derive it by stripping `teamName` off
  the end of full `name` rather than trusting `locationName` directly. Arizona
  Diamondbacks is the one hard exception (nickname mismatch) — hand-overridden
  in `cbssports`'s team reference table.
- **Team IDs are consistent across all these endpoints** — prefer looking teams
  up by `id` over `name` when a response might use the short form (standings
  responses do).
- This app is specifically about **live game / At Bat coverage**, which
  `cbssports` didn't need — likely relevant and unexplored so far:
  live play-by-play / pitch-by-pitch data (MLB Stats API has `game/{gamePk}/
  playByPlay` and `game/{gamePk}/feed/live` endpoints — not yet verified or
  used in either project, confirm shape before relying on them), and possibly
  audio/video stream endpoints if this app ever offered live-look-in or radio
  (unknown whether those still exist or are paywalled/blocked without a
  MLB.TV/At Bat subscription — check early, this may be a hard restoration
  blocker unrelated to webOS itself).

**Team logos** — `https://www.mlbstatic.com/team-logos/{statsApiTeamId}.svg`,
MLB's own official CDN. Confirmed working (200, `image/svg+xml`) via direct
request, no auth required.

**TheSportsDB** (`thesportsdb.com`, free key `123`) — evaluated for `cbssports`
and **rejected** as a primary source: thin free-tier coverage (1-3 games/day
against a real ~15-game slate via `eventsday.php`), `lookuptable.php`
(standings) returns empty for American sports leagues on the free tier. Not
expected to be useful here either, but noted in case MLB Stats API is missing
something this app specifically needs.

## Resolved early questions

- **Original backend:** MLB Advanced Media's own feeds (`m.mlb.com`,
  `gdx.mlb.com`). All are dead; bundled `data/localConfig.js` and
  `data/localExtras.js` stand in for the config and extras services.
- **Subscription:** live radio needs the user's own MLB login, entered in the
  app (self-service, never baked in). Everything else is free public data.
