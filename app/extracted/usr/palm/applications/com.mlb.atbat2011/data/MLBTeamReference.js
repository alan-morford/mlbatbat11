// Fresh team reference table, replacing reliance on data/clubProps.js (baked
// in 2011, stale for the A's/Marlins/Guardians renames and relocations since
// then -- e.g. clubProps still has "Florida Marlins"/"Oakland Athletics").
// Generated once from https://statsapi.mlb.com/api/v1/teams?sportId=1&activeStatus=Y
// (location derived by stripping teamName off the end of name, per this
// project's CLAUDE.md) and cross-checked against
// https://a.espncdn.com/i/teamlogos/mlb/500/{espnSlug}.png for all 30 teams --
// espnSlug matches the lowercased Stats API abbreviation for every team
// except two hand-overridden below: Arizona (Stats API's own "AZ" 404s on
// ESPN's CDN; ESPN uses "ari") and the White Sox (Stats API's "CWS" isn't
// recognized by ESPN's news endpoint at all -- confirmed live 2026-08-08,
// team=cws returns a flat HTTP 400, not just an empty/wrong result, which
// is what silently showed as "no articles" in the News tab; ESPN's own
// team list, site.api.espn.com/.../mlb/teams, confirms its real
// abbreviation is "CHW"). clubProps.js is left in place, still used by
// lib/bam.MasterScoreboard.js's dead code path.
var MLBTeamReference = {};

MLBTeamReference.teams = [
	{ id: 109, name: "Arizona Diamondbacks", abbreviation: "AZ", espnSlug: "ari", location: "Arizona", nickname: "Diamondbacks" },
	{ id: 133, name: "Athletics", abbreviation: "ATH", espnSlug: "ath", location: "", nickname: "Athletics" },
	{ id: 144, name: "Atlanta Braves", abbreviation: "ATL", espnSlug: "atl", location: "Atlanta", nickname: "Braves" },
	{ id: 110, name: "Baltimore Orioles", abbreviation: "BAL", espnSlug: "bal", location: "Baltimore", nickname: "Orioles" },
	{ id: 111, name: "Boston Red Sox", abbreviation: "BOS", espnSlug: "bos", location: "Boston", nickname: "Red Sox" },
	{ id: 112, name: "Chicago Cubs", abbreviation: "CHC", espnSlug: "chc", location: "Chicago", nickname: "Cubs" },
	{ id: 145, name: "Chicago White Sox", abbreviation: "CWS", espnSlug: "chw", location: "Chicago", nickname: "White Sox" },
	{ id: 113, name: "Cincinnati Reds", abbreviation: "CIN", espnSlug: "cin", location: "Cincinnati", nickname: "Reds" },
	{ id: 114, name: "Cleveland Guardians", abbreviation: "CLE", espnSlug: "cle", location: "Cleveland", nickname: "Guardians" },
	{ id: 115, name: "Colorado Rockies", abbreviation: "COL", espnSlug: "col", location: "Colorado", nickname: "Rockies" },
	{ id: 116, name: "Detroit Tigers", abbreviation: "DET", espnSlug: "det", location: "Detroit", nickname: "Tigers" },
	{ id: 117, name: "Houston Astros", abbreviation: "HOU", espnSlug: "hou", location: "Houston", nickname: "Astros" },
	{ id: 118, name: "Kansas City Royals", abbreviation: "KC", espnSlug: "kc", location: "Kansas City", nickname: "Royals" },
	{ id: 108, name: "Los Angeles Angels", abbreviation: "LAA", espnSlug: "laa", location: "Los Angeles", nickname: "Angels" },
	{ id: 119, name: "Los Angeles Dodgers", abbreviation: "LAD", espnSlug: "lad", location: "Los Angeles", nickname: "Dodgers" },
	{ id: 146, name: "Miami Marlins", abbreviation: "MIA", espnSlug: "mia", location: "Miami", nickname: "Marlins" },
	{ id: 158, name: "Milwaukee Brewers", abbreviation: "MIL", espnSlug: "mil", location: "Milwaukee", nickname: "Brewers" },
	{ id: 142, name: "Minnesota Twins", abbreviation: "MIN", espnSlug: "min", location: "Minnesota", nickname: "Twins" },
	{ id: 121, name: "New York Mets", abbreviation: "NYM", espnSlug: "nym", location: "New York", nickname: "Mets" },
	{ id: 147, name: "New York Yankees", abbreviation: "NYY", espnSlug: "nyy", location: "New York", nickname: "Yankees" },
	{ id: 143, name: "Philadelphia Phillies", abbreviation: "PHI", espnSlug: "phi", location: "Philadelphia", nickname: "Phillies" },
	{ id: 134, name: "Pittsburgh Pirates", abbreviation: "PIT", espnSlug: "pit", location: "Pittsburgh", nickname: "Pirates" },
	{ id: 135, name: "San Diego Padres", abbreviation: "SD", espnSlug: "sd", location: "San Diego", nickname: "Padres" },
	{ id: 137, name: "San Francisco Giants", abbreviation: "SF", espnSlug: "sf", location: "San Francisco", nickname: "Giants" },
	{ id: 136, name: "Seattle Mariners", abbreviation: "SEA", espnSlug: "sea", location: "Seattle", nickname: "Mariners" },
	{ id: 138, name: "St. Louis Cardinals", abbreviation: "STL", espnSlug: "stl", location: "St. Louis", nickname: "Cardinals" },
	{ id: 139, name: "Tampa Bay Rays", abbreviation: "TB", espnSlug: "tb", location: "Tampa Bay", nickname: "Rays" },
	{ id: 140, name: "Texas Rangers", abbreviation: "TEX", espnSlug: "tex", location: "Texas", nickname: "Rangers" },
	{ id: 141, name: "Toronto Blue Jays", abbreviation: "TOR", espnSlug: "tor", location: "Toronto", nickname: "Blue Jays" },
	{ id: 120, name: "Washington Nationals", abbreviation: "WSH", espnSlug: "wsh", location: "Washington", nickname: "Nationals" }
];

MLBTeamReference.byId = {};
MLBTeamReference.byAbbreviation = {};
(function () {
	for (var i = 0; i < MLBTeamReference.teams.length; i++) {
		var team = MLBTeamReference.teams[i];
		MLBTeamReference.byId[team.id] = team;
		MLBTeamReference.byAbbreviation[team.abbreviation] = team;
	}
})();

MLBTeamReference.getById = function (id) {
	return MLBTeamReference.byId[id] || null;
};

// Prefer this over getById() when working from a live Stats API game/team
// object, since abbreviation is what those responses actually carry -- also
// applies the AZ->ari ESPN-slug override automatically.
MLBTeamReference.getByAbbreviation = function (abbreviation) {
	return MLBTeamReference.byAbbreviation[abbreviation] || null;
};

MLBTeamReference.getEspnSlug = function (abbreviation) {
	var team = MLBTeamReference.byAbbreviation[abbreviation];
	return team ? team.espnSlug : (abbreviation || "").toLowerCase();
};
