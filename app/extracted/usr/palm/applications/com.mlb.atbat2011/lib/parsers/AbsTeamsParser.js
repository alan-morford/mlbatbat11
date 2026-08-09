// Parses lib/WebServices.js's AbsTeamRosterStatsAPIService (roster+hydrate)
// and AbsPlayerYearByYearStatsAPIService (yearByYear) responses for
// views/AbsTeamsView.js's ABS Stats "Teams" tab. Same stat field names as
// lib/parsers/GamedayParser.js's formatBattingStats/formatPitchingStats
// (avg/homeRuns/rbi, era/wins/losses/strikeOuts) -- not reused directly
// since those two functions unwrap a DIFFERENT source shape
// (boxscorePlayer.seasonStats.batting/pitching, from feed/live's boxscore),
// not this file's roster-hydrate/yearByYear splits[].stat shape.
var AbsTeamsParser = {};

AbsTeamsParser.formatBattingStats = function (stat) {
	var s = stat || {};
	return {
		avg: (s.avg !== undefined) ? s.avg : ".000",
		homeRuns: (s.homeRuns !== undefined) ? s.homeRuns : 0,
		rbi: (s.rbi !== undefined) ? s.rbi : 0,
		obp: (s.obp !== undefined) ? s.obp : ".000",
		slg: (s.slg !== undefined) ? s.slg : ".000",
		ops: (s.ops !== undefined) ? s.ops : ".000",
		gamesPlayed: (s.gamesPlayed !== undefined) ? s.gamesPlayed : 0
	};
};

AbsTeamsParser.formatPitchingStats = function (stat) {
	var s = stat || {};
	return {
		era: (s.era !== undefined) ? s.era : "0.00",
		wins: (s.wins !== undefined) ? s.wins : 0,
		losses: (s.losses !== undefined) ? s.losses : 0,
		strikeOuts: (s.strikeOuts !== undefined) ? s.strikeOuts : 0,
		whip: (s.whip !== undefined) ? s.whip : "0.00",
		saves: (s.saves !== undefined) ? s.saves : 0,
		gamesPlayed: (s.gamesPlayed !== undefined) ? s.gamesPlayed : 0
	};
};

// True if this player's PRIMARY role is pitching, straight off Stats API's
// own primaryPosition.abbreviation ("P" for every pitcher role). No special
// two-way-player handling -- same simplification GamedayParser's own
// statType convention already makes elsewhere in this app.
AbsTeamsParser.isPitcher = function (person) {
	var pos = (person && person.primaryPosition) || {};
	return pos.abbreviation === "P";
};

// Pulls this ONE player's own season stat line out of Stats API's
// hydrate-attached person.stats[] array. Both a "hitting" AND a "pitching"
// group entry come back for EVERY player regardless of position -- hydrate
// doesn't filter by position -- confirmed live (2026-08-08 spike test):
// a pure pitcher's "hitting" group is present too, just all-zero. This picks
// whichever one group actually matches the position this function's own
// isPitcher() call decided on.
AbsTeamsParser.extractSeasonStat = function (person, wantPitching) {
	var groups = (person && person.stats) || [];
	var wantGroupName = wantPitching ? "pitching" : "hitting";
	for (var i = 0; i < groups.length; i++) {
		var g = groups[i];
		if (g.group && g.group.displayName === wantGroupName &&
				g.splits && g.splits.length && g.splits[0].stat) {
			return g.splits[0].stat;
		}
	}
	return null;
};

// roster: Stats API's own {roster: [{person, jerseyNumber, ...}, ...]}
// shape. Returns {positionPlayers: [...], pitchers: [...]}, each entry
// {id, name, lastName, number, positionAbbr, isPitcher, stats}, each group
// alphabetized by last name (person.boxscoreName is already just the last
// name per Stats API convention -- confirmed live, e.g. "Civale" not
// "Aaron Civale").
AbsTeamsParser.parseRoster = function (json) {
	var rosterEntries = (json && json.roster) || [];
	var positionPlayers = [];
	var pitchers = [];
	for (var i = 0; i < rosterEntries.length; i++) {
		var entry = rosterEntries[i];
		var person = entry.person || {};
		if (!person.id) { continue; }
		var pitching = AbsTeamsParser.isPitcher(person);
		var stat = AbsTeamsParser.extractSeasonStat(person, pitching);
		var player = {
			id : person.id,
			name : person.fullName || "",
			lastName : person.boxscoreName || person.lastName || person.fullName || "",
			number : entry.jerseyNumber || person.primaryNumber || "",
			positionAbbr : (person.primaryPosition && person.primaryPosition.abbreviation) || "",
			isPitcher : pitching,
			stats : pitching ? AbsTeamsParser.formatPitchingStats(stat) : AbsTeamsParser.formatBattingStats(stat)
		};
		(pitching ? pitchers : positionPlayers).push(player);
	}
	var byLastName = function (a, b) {
		return a.lastName < b.lastName ? -1 : (a.lastName > b.lastName ? 1 : 0);
	};
	positionPlayers.sort(byLastName);
	pitchers.sort(byLastName);
	return { positionPlayers : positionPlayers, pitchers : pitchers };
};

// yearByYear response -- one row per season. Stats API returns a separate
// split per team a player was on that season PLUS a combined/aggregate
// split (team absent, numTeams set) for any season with more than one team
// -- confirmed live (2026-08-08 spike test, personId 650644, a player
// traded mid-season multiple years running): picking only the aggregate
// row when one exists (falling back to the single team row otherwise)
// avoids showing 2-3 duplicate rows for the same season.
AbsTeamsParser.parseYearByYear = function (json) {
	var groups = (json && json.stats) || [];
	var splits = (groups.length && groups[0].splits) || [];
	var bySeason = {};
	var order = [];
	for (var i = 0; i < splits.length; i++) {
		var sp = splits[i];
		var season = sp.season;
		if (!season) { continue; }
		var existing = bySeason[season];
		// Prefer the combined/aggregate split (numTeams set, team absent)
		// over any single-team split already stored for the same season.
		if (!existing || sp.numTeams) {
			if (!existing) { order.push(season); }
			bySeason[season] = sp;
		}
	}
	order.sort(function (a, b) { return b - a; }); // most recent season first

	var rows = [];
	for (var j = 0; j < order.length; j++) {
		var sp2 = bySeason[order[j]];
		var teamName = sp2.team ? sp2.team.name : (sp2.numTeams ? (sp2.numTeams + " Teams") : "");
		rows.push({ season : order[j], team : teamName, stat : sp2.stat || {} });
	}
	return rows;
};
