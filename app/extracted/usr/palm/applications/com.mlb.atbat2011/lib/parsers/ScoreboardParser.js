// Parses MLB Stats API's schedule response (statsapi.mlb.com/api/v1/schedule)
// into the flat game shape ScoreboardGameBox/ScoreboardList expect. This
// replaces the old bam.MasterScoreboard.extendGame() pipeline, which existed
// to feed a generic jQuery template -- a native Enyo view doesn't need that
// indirection, so this shape is deliberately minimal rather than a replica.
var ScoreboardParser = {};

ScoreboardParser.parseTeam = function (teamSide) {
	var team = teamSide.team || {};
	return {
		id: team.id,
		name: team.name,
		abbreviation: team.abbreviation,
		score: teamSide.score
	};
};

ScoreboardParser.parseGame = function (game) {
	var status = game.status || {};
	var linescore = game.linescore || {};
	var abstractState = status.abstractGameState || "";

	return {
		gamePk: game.gamePk,
		gameDate: game.gameDate,
		status: {
			abstractGameState: abstractState,
			detailedState: status.detailedState || "",
			isFinal: abstractState === "Final",
			isLive: abstractState === "Live",
			isPreview: abstractState === "Preview"
		},
		awayTeam: ScoreboardParser.parseTeam(game.teams.away),
		homeTeam: ScoreboardParser.parseTeam(game.teams.home),
		inning: linescore.currentInning,
		inningState: linescore.inningState,
		linescore: linescore
	};
};

ScoreboardParser.parseScoreboardFromStatsAPI = function (json) {
	var dates = (json && json.dates) || [];
	var rawGames = dates.length > 0 ? dates[0].games : [];
	var games = [];

	for (var i = 0; i < rawGames.length; i++) {
		games.push(ScoreboardParser.parseGame(rawGames[i]));
	}

	return {
		date: dates.length > 0 ? dates[0].date : null,
		games: games
	};
};
