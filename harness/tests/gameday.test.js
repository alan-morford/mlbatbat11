const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAppFile } = require("../loadAppFile");

const STATS_API_LIVE_BASE = "https://statsapi.mlb.com/api/v1.1";

// A known, completed game: 2024-06-15, Cardinals @ Cubs, Cubs won 5-1.
const KNOWN_GAME_PK = 746865;

function loadGamedayParser() {
	const ctx = loadAppFile("lib/parsers/GamedayParser.js");
	return ctx.GamedayParser;
}

test("GamedayParser parses a real completed game's live feed", async () => {
	const GamedayParser = loadGamedayParser();

	const url = `${STATS_API_LIVE_BASE}/game/${KNOWN_GAME_PK}/feed/live`;
	const res = await fetch(url);
	assert.equal(res.status, 200, `expected 200 from ${url}`);
	const json = await res.json();

	const game = GamedayParser.parseGameFeed(json);

	assert.equal(game.awayTeamName, "St. Louis Cardinals");
	assert.equal(game.homeTeamName, "Chicago Cubs");
	assert.equal(game.abstractGameState, "Final");
	assert.match(game.officialDate, /^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD officialDate");

	assert.ok(game.linescore, "expected a parsed linescore");
	assert.equal(game.linescore.awayTotals.runs, 1);
	assert.equal(game.linescore.homeTotals.runs, 5);
	assert.ok(game.linescore.innings.length >= 9, "expected at least 9 innings");

	assert.ok(game.plays.length > 0, "expected at least one play");
	const mostRecentPlay = game.plays[0];
	assert.ok(mostRecentPlay.description, "most recent play should have a description");
	assert.equal(mostRecentPlay.inning, 9, "plays should be reversed, most recent (9th) first");

	console.log(
		`Sample linescore: ${game.awayTeamName} ${game.linescore.awayTotals.runs} - ` +
			`${game.homeTeamName} ${game.linescore.homeTotals.runs}`
	);
	console.log(`Most recent play: [${mostRecentPlay.halfInning} ${mostRecentPlay.inning}] ${mostRecentPlay.description}`);

	// currentPlay for a completed game still reflects the final at-bat (same
	// atBatIndex as the last entry in allPlays, confirmed live) -- so a
	// finished game should still yield real pitch data, not the empty
	// Preview-game default.
	assert.ok(game.currentAtBat, "expected a currentAtBat object");
	assert.ok(game.currentAtBat.pitches.length > 0, "expected at least one pitch for the final at-bat");
	const firstPitch = game.currentAtBat.pitches[0];
	assert.equal(typeof firstPitch.pX, "number");
	assert.equal(typeof firstPitch.pZ, "number");
	assert.equal(typeof game.currentAtBat.strikeZoneTop, "number");
	assert.equal(typeof game.currentAtBat.strikeZoneBottom, "number");
	assert.ok(game.currentAtBat.strikeZoneTop > game.currentAtBat.strikeZoneBottom, "zone top should be above zone bottom");

	// matchup: current batter/pitcher + handedness + season stat line, all
	// sourced from the same feed/live response already being fetched.
	assert.ok(game.matchup, "expected a matchup object");
	assert.ok(game.matchup.batter, "expected a batter for the final at-bat");
	assert.ok(game.matchup.batter.name, "expected a batter name");
	assert.match(game.matchup.batter.handedness, /^[LR]$/, "batter handedness should be L or R");
	assert.equal(typeof game.matchup.batter.stats.avg, "string");
	assert.ok(game.matchup.pitcher, "expected a pitcher for the final at-bat");
	assert.ok(game.matchup.pitcher.name, "expected a pitcher name");
	assert.match(game.matchup.pitcher.handedness, /^[LR]$/, "pitcher handedness should be L or R");
	assert.equal(typeof game.matchup.pitcher.stats.era, "string");
	if (game.matchup.onDeck) {
		assert.ok(game.matchup.onDeck.id, "onDeck should have a person id for the headshot");
		assert.ok(game.matchup.onDeck.name, "onDeck should have a name");
	}

	console.log(
		`Current at-bat: ${game.matchup.batter.name} (bats ${game.matchup.batter.handedness}, ` +
			`avg ${game.matchup.batter.stats.avg}) vs ${game.matchup.pitcher.name} ` +
			`(throws ${game.matchup.pitcher.handedness}, era ${game.matchup.pitcher.stats.era}), ` +
			`${game.currentAtBat.pitches.length} pitches, ` +
			`zone ${game.currentAtBat.strikeZoneBottom.toFixed(2)}-${game.currentAtBat.strikeZoneTop.toFixed(2)}`
	);
});

test("GamedayParser handles a not-yet-started (Preview) game without 'undefined' totals", async () => {
	const GamedayParser = loadGamedayParser();

	// Find a real Preview-status game off today's schedule -- this is the
	// common case when no games are currently live, and it has a real
	// on-device bug history: linescore.teams.away/home come back as {}
	// (not absent) for these, which an earlier version of this parser
	// rendered as the literal string "undefined".
	const today = new Date().toISOString().slice(0, 10);
	const scheduleRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`);
	const scheduleJson = await scheduleRes.json();
	const games = (scheduleJson.dates[0] || {}).games || [];
	const previewGame = games.find((g) => g.status.abstractGameState === "Preview");

	if (!previewGame) {
		console.log("No Preview-status game found today -- skipping (nothing to assert against)");
		return;
	}

	const res = await fetch(`${STATS_API_LIVE_BASE}/game/${previewGame.gamePk}/feed/live`);
	assert.equal(res.status, 200);
	const json = await res.json();

	const game = GamedayParser.parseGameFeed(json);

	assert.equal(game.abstractGameState, "Preview");
	assert.equal(typeof game.linescore.awayTotals.runs, "number", "awayTotals.runs must be a number, not undefined/'undefined'");
	assert.equal(typeof game.linescore.homeTotals.runs, "number", "homeTotals.runs must be a number, not undefined/'undefined'");
	assert.equal(game.linescore.awayTotals.runs, 0);
	assert.equal(game.linescore.homeTotals.runs, 0);
	assert.equal(game.plays.length, 0);

	// currentPlay is undefined entirely for a Preview game (confirmed
	// live) -- parseCurrentAtBatPitches() must degrade to the empty/default
	// shape, not throw.
	assert.ok(game.currentAtBat, "expected a currentAtBat object even with no currentPlay");
	assert.equal(game.currentAtBat.pitches.length, 0);
	assert.equal(typeof game.currentAtBat.strikeZoneTop, "number");
	assert.equal(typeof game.currentAtBat.strikeZoneBottom, "number");

	// matchup must degrade to nulls/empty rather than throw when
	// currentPlay is absent entirely (every Preview game, confirmed live).
	assert.ok(game.matchup, "expected a matchup object even with no currentPlay");
	assert.equal(game.matchup.batter, null);
	assert.equal(game.matchup.pitcher, null);
	assert.equal(game.matchup.onDeck, null);

	console.log(`Preview game ${previewGame.gamePk}: totals correctly zeroed, ${game.plays.length} plays, ${game.currentAtBat.pitches.length} pitches, matchup nulled`);
});
