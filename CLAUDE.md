# MLB At Bat 11 — webOS Restoration

This project restores **MLB At Bat 11**, MLB Advanced Media's official app for HP's
webOS 3.0.5 (HP TouchPad). Like `cbssports` (a sibling restoration project — see
`../cbssports` for prior art), this app is long since broken: MLB shut down or
changed the backend feeds it originally shipped against, so live data paths are
dead until repointed at current sources.

## Current state

`app/` contains the original package **unextracted**: `debian-binary`,
`control.tar.gz`, `data.tar.gz` — the raw `.ipk` structure. Nothing has been
unpacked or explored yet. First step when starting real work: extract these
(`ar x` or manual tar extraction) to get at `appinfo.json`, the JS/HTML/CSS
source, and any bundled resources, the same way `cbssports/app/extracted/...`
is laid out.

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
- Claude has **no direct device or console access** — no live console, no
  emulator use by default (user prefers testing on real hardware over the
  emulator; ask before assuming otherwise). The user installs builds via
  `palm-install.bat` themselves and reports back what they see. For debugging,
  plan on an on-device logger (`cbssports` used `SportsLogger.js`, writing to
  `/media/internal/...` with a `localStorage` fallback, since the FileSystem-API
  write path was never confirmed working) — the same pattern will likely be
  needed here, and Claude should verify data-layer logic via a Node.js harness
  that shims the minimal `enyo.kind`/Mojo surface and loads real unmodified app
  source, hitting live APIs to confirm the pipeline before ever handing off a
  build.
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

## Open questions to resolve early in this project

- What did MLB At Bat 11's original backend look like (feed domains, whether it
  used MLB Advanced Media's own API vs. something third-party)? Check
  `appinfo.json`/source once extracted — likely dead endpoints similar to
  `cbssports`'s CBS feeds.
- Does this app's core value proposition (live look-ins, radio/audio, real-time
  play-by-play) require an active MLB.TV/At Bat subscription and auth token
  that Claude/the user can't obtain? If so, scope may need to shrink to
  scores/standings/news, similar to how `cbssports` ended up scoped to MLB only
  out of its original multi-sport design.
