// Parses MLB Stats API's standings response
// (statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=YYYY) into a
// flat array of division groups for views/StandingsList.js. Note the
// short-vs-full team name gotcha documented in this project's CLAUDE.md:
// standings responses give team.name as the SHORT name (e.g. "Yankees"),
// unlike the schedule endpoint's full name -- fine for a standings table,
// but don't cross-reference against schedule data by name, use team.id.
var StandingsParser = {};

// MLB's division structure is stable across seasons -- a static lookup
// avoids an extra network round trip just to get division display names.
StandingsParser.DIVISION_NAMES = {
	200: "AL West",
	201: "AL East",
	202: "AL Central",
	203: "NL West",
	204: "NL East",
	205: "NL Central"
};

StandingsParser.LEAGUE_NAMES = {
	103: "American League",
	104: "National League"
};

StandingsParser.parseTeamRecord = function (teamRecord) {
	return {
		id: teamRecord.team.id,
		name: teamRecord.team.name,
		wins: teamRecord.wins,
		losses: teamRecord.losses,
		pct: teamRecord.winningPercentage,
		gamesBack: teamRecord.gamesBack,
		wildCardGamesBack: teamRecord.wildCardGamesBack,
		streak: teamRecord.streak ? teamRecord.streak.streakCode : "",
		divisionRank: parseInt(teamRecord.divisionRank, 10) || 0
	};
};

StandingsParser.parseDivisionRecord = function (record) {
	var divisionId = record.division.id;
	var teams = [];

	for (var i = 0; i < record.teamRecords.length; i++) {
		teams.push(StandingsParser.parseTeamRecord(record.teamRecords[i]));
	}

	teams.sort(function (a, b) {
		return a.divisionRank - b.divisionRank;
	});

	return {
		leagueId: record.league.id,
		leagueName: StandingsParser.LEAGUE_NAMES[record.league.id] || "",
		divisionId: divisionId,
		divisionName: StandingsParser.DIVISION_NAMES[divisionId] || "",
		teams: teams
	};
};

StandingsParser.parseStandingsFromStatsAPI = function (json) {
	var records = (json && json.records) || [];
	var divisions = [];

	for (var i = 0; i < records.length; i++) {
		divisions.push(StandingsParser.parseDivisionRecord(records[i]));
	}

	divisions.sort(function (a, b) {
		return a.divisionId - b.divisionId;
	});

	return divisions;
};

// Re-groups the already-fetched division data by league for the Wild Card
// toggle -- no second network call needed, Stats API's team records already
// carry wildCardGamesBack. Sorted by win differential as a simple, clearly-
// approximate proxy for wild card standing (not the official tiebreaker
// algorithm).
StandingsParser.groupByLeagueForWildCard = function (divisions) {
	var byLeague = {};

	for (var i = 0; i < divisions.length; i++) {
		var division = divisions[i];
		if (!byLeague[division.leagueId]) {
			byLeague[division.leagueId] = {
				leagueId: division.leagueId,
				leagueName: division.leagueName,
				teams: []
			};
		}
		byLeague[division.leagueId].teams = byLeague[division.leagueId].teams.concat(division.teams);
	}

	var leagues = [];
	for (var leagueId in byLeague) {
		var league = byLeague[leagueId];
		league.teams.sort(function (a, b) {
			return (b.wins - b.losses) - (a.wins - a.losses);
		});
		leagues.push(league);
	}

	leagues.sort(function (a, b) {
		return a.leagueId - b.leagueId;
	});

	return leagues;
};
