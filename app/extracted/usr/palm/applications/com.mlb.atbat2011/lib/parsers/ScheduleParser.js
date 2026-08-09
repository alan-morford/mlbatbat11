// Parses MLB Stats API's schedule?teamId=X&startDate=...&endDate=...
// response (views/ScheduleView.js's mlb.ScheduleCalendar) into a plain
// { "YYYY-MM-DD": gameInfo } map, one entry per calendar day this team
// played (or is scheduled to play) within the requested range.
var ScheduleParser = {};

// teamId: the Stats API team id whose perspective this calendar is built
// from (which side is "us" vs "opponent").
ScheduleParser.parseTeamSchedule = function (json, teamId) {
	var byDate = {};
	var dates = (json && json.dates) || [];
	for (var i = 0; i < dates.length; i++) {
		var games = dates[i].games || [];
		for (var j = 0; j < games.length; j++) {
			var g = games[j];
			var teams = g.teams || {};
			var homeSide = teams.home || {};
			var awaySide = teams.away || {};
			var isHome = homeSide.team && homeSide.team.id === teamId;
			var us = isHome ? homeSide : awaySide;
			var opp = isHome ? awaySide : homeSide;
			var status = g.status || {};

			// Doubleheaders share one officialDate -- last game of the day
			// wins in this map (a rare edge case; a full two-games-in-one-
			// cell layout wasn't worth the extra complexity for a month
			// overview calendar).
			byDate[g.officialDate] = {
				gamePk: g.gamePk,
				officialDate: g.officialDate,
				gameDate: g.gameDate,
				opponentId: opp.team && opp.team.id,
				opponentName: (opp.team && opp.team.name) || "",
				isHome: !!isHome,
				abstractGameState: status.abstractGameState || "",
				detailedState: status.detailedState || "",
				isFinal: status.abstractGameState === "Final",
				usScore: (typeof us.score === "number") ? us.score : null,
				oppScore: (typeof opp.score === "number") ? opp.score : null,
				isWinner: !!us.isWinner
			};
		}
	}
	return byDate;
};
