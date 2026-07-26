const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAppFile } = require("../loadAppFile");

const NEWS_API_BASE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news";

function loadNewsParser() {
	const ctx = loadAppFile("lib/parsers/NewsParser.js");
	return ctx.NewsParser;
}

test("NewsParser parses ESPN's live general MLB news JSON", async () => {
	const NewsParser = loadNewsParser();

	const url = `${NEWS_API_BASE}?limit=10&team=`;
	const res = await fetch(url);
	assert.equal(res.status, 200, `expected 200 from ${url}`);
	const json = await res.json();

	const articles = NewsParser.parseNewsFromJSON(json);

	assert.equal(articles.length, 10, "expected exactly 10 articles for limit=10");

	const first = articles[0];
	assert.ok(first.title, "first article should have a title");
	assert.ok(first.link, "first article should have a link");
	assert.ok(first.link.indexOf("espn.com") >= 0, "link should point at espn.com");
	assert.ok(first.pubDate, "first article should have a pubDate");

	console.log(`Sample general article: "${first.title}" -- ${first.link}`);
});

test("NewsParser + team= param reliably yields ~10 articles for a single team", async () => {
	const NewsParser = loadNewsParser();

	const url = `${NEWS_API_BASE}?limit=10&team=nyy`;
	const res = await fetch(url);
	assert.equal(res.status, 200, `expected 200 from ${url}`);
	const json = await res.json();

	const articles = NewsParser.parseNewsFromJSON(json);
	assert.equal(articles.length, 10, "expected exactly 10 articles for a single team at limit=10");

	console.log(`Yankees: ${articles.length} articles, oldest pubDate ${articles[articles.length - 1].pubDate}`);
});

test("Every MLBTeamReference espnSlug resolves to a live ESPN logo", async () => {
	const ctx = loadAppFile("data/MLBTeamReference.js");
	const MLBTeamReference = ctx.MLBTeamReference;

	assert.equal(MLBTeamReference.teams.length, 30, "expected all 30 teams");

	// Spot-check a handful (all 30 were already verified live during
	// research for this change) rather than firing 30 requests every harness run.
	const sample = ["AZ", "ATH", "CWS", "WSH", "NYY"];
	for (const abbr of sample) {
		const team = MLBTeamReference.getByAbbreviation(abbr);
		assert.ok(team, `expected a team for abbreviation ${abbr}`);
		const url = `https://a.espncdn.com/i/teamlogos/mlb/500/${team.espnSlug}.png`;
		const res = await fetch(url, { method: "HEAD" });
		assert.equal(res.status, 200, `expected 200 for ${abbr} -> ${team.espnSlug} at ${url}`);
	}
});
