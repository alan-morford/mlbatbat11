const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAppFile } = require("../loadAppFile");

const STATS_API_BASE = "https://statsapi.mlb.com/api/v1";

// A fixed, known past date with a full slate of games -- stable test data,
// won't change over time.
const KNOWN_PAST_DATE = "2024-06-15";

// A far-future date, guaranteed to have no scheduled games yet.
const FAR_FUTURE_DATE = "2030-01-01";

function loadScoreboardParser() {
	const ctx = loadAppFile("lib/parsers/ScoreboardParser.js");
	return ctx.ScoreboardParser;
}

test("ScoreboardParser parses a real day's schedule from MLB Stats API", async () => {
	const ScoreboardParser = loadScoreboardParser();

	const url = `${STATS_API_BASE}/schedule?sportId=1&hydrate=team,linescore&date=${KNOWN_PAST_DATE}`;
	const res = await fetch(url);
	assert.equal(res.status, 200, `expected 200 from ${url}`);
	const json = await res.json();

	const result = ScoreboardParser.parseScoreboardFromStatsAPI(json);

	assert.equal(result.date, KNOWN_PAST_DATE);
	assert.ok(result.games.length > 0, "expected at least one game on a known full slate day");

	const game = result.games[0];
	assert.ok(game.gamePk, "game.gamePk should be present");
	assert.ok(game.awayTeam.name, "game.awayTeam.name should be present");
	assert.ok(game.homeTeam.name, "game.homeTeam.name should be present");
	assert.equal(game.status.isFinal, true, "a 2024-06-15 game should be Final by now");
	assert.equal(typeof game.awayTeam.score, "number");
	assert.equal(typeof game.homeTeam.score, "number");

	console.log(
		`Sample parsed game: ${game.awayTeam.name} (${game.awayTeam.score}) @ ` +
			`${game.homeTeam.name} (${game.homeTeam.score}) -- ${game.status.detailedState}`
	);
});

test("ScoreboardParser handles a date with no scheduled games", async () => {
	const ScoreboardParser = loadScoreboardParser();

	const url = `${STATS_API_BASE}/schedule?sportId=1&hydrate=team,linescore&date=${FAR_FUTURE_DATE}`;
	const res = await fetch(url);
	assert.equal(res.status, 200, `expected 200 from ${url}`);
	const json = await res.json();

	const result = ScoreboardParser.parseScoreboardFromStatsAPI(json);
	assert.equal(result.games.length, 0, "expected an empty games array for a date with no schedule");
});
