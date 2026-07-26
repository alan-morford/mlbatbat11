const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAppFile } = require("../loadAppFile");

const STATS_API_BASE = "https://statsapi.mlb.com/api/v1";

// A complete, stable past season -- won't change over time.
const KNOWN_SEASON = "2024";

function loadStandingsParser() {
	const ctx = loadAppFile("lib/parsers/StandingsParser.js");
	return ctx.StandingsParser;
}

test("StandingsParser parses a real season's standings from MLB Stats API", async () => {
	const StandingsParser = loadStandingsParser();

	const url = `${STATS_API_BASE}/standings?leagueId=103,104&season=${KNOWN_SEASON}`;
	const res = await fetch(url);
	assert.equal(res.status, 200, `expected 200 from ${url}`);
	const json = await res.json();

	const divisions = StandingsParser.parseStandingsFromStatsAPI(json);

	assert.equal(divisions.length, 6, "expected 6 MLB divisions");

	for (const division of divisions) {
		assert.ok(division.divisionName, `division ${division.divisionId} should have a resolved name`);
		assert.ok(division.leagueName, `division ${division.divisionId} should have a resolved league name`);
		assert.equal(division.teams.length, 5, `division ${division.divisionName} should have 5 teams`);
	}

	const alEast = divisions.find((d) => d.divisionId === 201);
	assert.equal(alEast.divisionName, "AL East");
	assert.equal(alEast.leagueName, "American League");

	const firstPlace = alEast.teams[0];
	assert.equal(firstPlace.name, "Yankees", "2024 AL East winner should be the Yankees");
	assert.equal(firstPlace.wins, 94);
	assert.equal(firstPlace.losses, 68);

	console.log(
		`Sample division: ${alEast.divisionName} -- 1st: ${firstPlace.name} ` +
			`(${firstPlace.wins}-${firstPlace.losses}, ${firstPlace.pct})`
	);
});
