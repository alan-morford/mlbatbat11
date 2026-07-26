// Parses MLB Stats API's live game feed
// (statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live) into the shape
// views/GamedayLinescore.js + views/GamedayPlayByPlay.js +
// views/GamedayDiamond.js + views/GamedayPitchZone.js expect. Replaces the
// original mlb.GamedayView, which embedded a remote MLB-hosted pitch-tracker
// webpage (wapc.mlb.com/gd3/apps/native/palm.jsp, dead) rather than
// rendering any data itself -- there's no original parsing logic to port,
// this is all new (confirmed no prior art anywhere in this project or
// cbssports for pitch-location/baserunner-diamond visualization).
var GamedayParser = {};

GamedayParser.parseLinescore = function (linescore) {
	if (!linescore) {
		return null;
	}

	var innings = [];
	var rawInnings = linescore.innings || [];
	for (var i = 0; i < rawInnings.length; i++) {
		var inning = rawInnings[i];
		innings.push({
			num: inning.num,
			away: inning.away ? inning.away.runs : null,
			home: inning.home ? inning.home.runs : null
		});
	}

	var offense = linescore.offense || {};

	// For a Preview/Scheduled game (the common case right now -- nothing's
	// live), linescore.teams.away/home come back as {} (empty, not absent),
	// so a plain `|| fallback` never triggers and totals.runs would be
	// undefined -> rendered as the literal string "undefined". Same bug
	// class as the earlier Scoreboard score fix; normalize each field
	// individually instead of trusting the whole object's truthiness.
	var rawAway = (linescore.teams && linescore.teams.away) || {};
	var rawHome = (linescore.teams && linescore.teams.home) || {};

	return {
		currentInning: linescore.currentInning,
		inningState: linescore.inningState,
		isTopInning: linescore.isTopInning,
		balls: linescore.balls,
		strikes: linescore.strikes,
		outs: linescore.outs,
		innings: innings,
		awayTotals: { runs: rawAway.runs || 0, hits: rawAway.hits || 0, errors: rawAway.errors || 0 },
		homeTotals: { runs: rawHome.runs || 0, hits: rawHome.hits || 0, errors: rawHome.errors || 0 },
		// Only meaningfully populated for in-progress games.
		onFirst: !!offense.first,
		onSecond: !!offense.second,
		onThird: !!offense.third
	};
};

GamedayParser.parsePlays = function (plays) {
	var rawPlays = (plays && plays.allPlays) || [];
	var parsed = [];

	for (var i = 0; i < rawPlays.length; i++) {
		var play = rawPlays[i];
		var about = play.about || {};
		var result = play.result || {};

		parsed.push({
			inning: about.inning,
			halfInning: about.halfInning,
			isScoringPlay: !!about.isScoringPlay,
			description: result.description || "",
			awayScore: result.awayScore,
			homeScore: result.homeScore
		});
	}

	// Most recent at-bat first, for a scrolling feed the user reads top-down.
	parsed.reverse();
	return parsed;
};

// currentPlay represents the at-bat currently underway (which may still be
// in progress -- it's a distinct object from allPlays' last entry, which
// only contains COMPLETED at-bats). It's undefined entirely for a
// Preview/Scheduled game (confirmed live) -- that's the common case right
// now with nothing in progress, not an error, so this must degrade cleanly
// rather than throw.
GamedayParser.parseCurrentAtBatPitches = function (currentPlay) {
	if (!currentPlay || !currentPlay.playEvents) {
		return { pitches: [], strikeZoneTop: 3.5, strikeZoneBottom: 1.5 };
	}

	var pitches = [];
	var strikeZoneTop = null;
	var strikeZoneBottom = null;

	for (var i = 0; i < currentPlay.playEvents.length; i++) {
		var event = currentPlay.playEvents[i];
		if (!event.isPitch) {
			continue;
		}

		var pitchData = event.pitchData || {};
		var coords = pitchData.coordinates || {};
		var details = event.details || {};

		// strikeZoneTop/Bottom is per-batter, same across every pitch in one
		// at-bat -- grab it once, from whichever pitch has it first.
		if (strikeZoneTop === null && typeof pitchData.strikeZoneTop === "number") {
			strikeZoneTop = pitchData.strikeZoneTop;
			strikeZoneBottom = pitchData.strikeZoneBottom;
		}

		if (typeof coords.pX === "number" && typeof coords.pZ === "number") {
			pitches.push({
				pX: coords.pX,
				pZ: coords.pZ,
				isStrike: !!details.isStrike,
				isBall: !!details.isBall,
				isInPlay: !!details.isInPlay,
				description: details.description || ""
			});
		}
	}

	return {
		pitches: pitches,
		strikeZoneTop: (strikeZoneTop === null) ? 3.5 : strikeZoneTop,
		strikeZoneBottom: (strikeZoneBottom === null) ? 1.5 : strikeZoneBottom
	};
};

// boxscore.teams.{away|home}.players is keyed "ID"+personId (confirmed
// live). Checks BOTH sides rather than trusting offense/defense team
// mapping -- a wrong-side lookup would silently attribute one team's
// player's stats to the other team's player with nothing to catch it.
GamedayParser.findBoxscorePlayer = function (boxscore, personId) {
	if (!boxscore || !personId) {
		return null;
	}
	var teams = boxscore.teams || {};
	var sides = [teams.away, teams.home];
	for (var i = 0; i < sides.length; i++) {
		var players = (sides[i] && sides[i].players) || {};
		var entry = players["ID" + personId];
		if (entry) {
			return entry;
		}
	}
	return null;
};

GamedayParser.formatBattingStats = function (boxscorePlayer) {
	var s = (boxscorePlayer && boxscorePlayer.seasonStats && boxscorePlayer.seasonStats.batting) || {};
	return {
		avg: (s.avg !== undefined) ? s.avg : ".000",
		homeRuns: (s.homeRuns !== undefined) ? s.homeRuns : 0,
		rbi: (s.rbi !== undefined) ? s.rbi : 0
	};
};

GamedayParser.formatPitchingStats = function (boxscorePlayer) {
	var s = (boxscorePlayer && boxscorePlayer.seasonStats && boxscorePlayer.seasonStats.pitching) || {};
	return {
		era: (s.era !== undefined) ? s.era : "0.00",
		wins: (s.wins !== undefined) ? s.wins : 0,
		losses: (s.losses !== undefined) ? s.losses : 0,
		strikeOuts: (s.strikeOuts !== undefined) ? s.strikeOuts : 0
	};
};

// currentPlay.matchup carries the current batter/pitcher + handedness;
// linescore.offense.onDeck carries the next batter due up. Both are
// undefined/absent entirely for a Preview/Scheduled game (same case
// parseCurrentAtBatPitches already guards) -- degrade to nulls/empty
// rather than throw.
GamedayParser.parseMatchup = function (currentPlay, linescore, boxscore) {
	var matchup = (currentPlay && currentPlay.matchup) || {};
	var batter = matchup.batter || null;
	var pitcher = matchup.pitcher || null;
	var offense = (linescore && linescore.offense) || {};
	var onDeck = offense.onDeck || null;

	return {
		batter: batter ? {
			id: batter.id,
			name: batter.fullName || "",
			handedness: (matchup.batSide && matchup.batSide.code) || "",
			stats: GamedayParser.formatBattingStats(GamedayParser.findBoxscorePlayer(boxscore, batter.id))
		} : null,
		pitcher: pitcher ? {
			id: pitcher.id,
			name: pitcher.fullName || "",
			handedness: (matchup.pitchHand && matchup.pitchHand.code) || "",
			stats: GamedayParser.formatPitchingStats(GamedayParser.findBoxscorePlayer(boxscore, pitcher.id))
		} : null,
		// {id, name}, not just a name string -- the on-deck indicator needs
		// the id to build a headshot URL, same as batter/pitcher above.
		onDeck: onDeck ? { id: onDeck.id, name: onDeck.fullName || "" } : null
	};
};

GamedayParser.parseGameFeed = function (json) {
	var gameData = json.gameData || {};
	var teams = gameData.teams || {};
	var status = gameData.status || {};
	var liveData = json.liveData || {};

	return {
		awayTeamName: (teams.away && teams.away.name) || "",
		homeTeamName: (teams.home && teams.home.name) || "",
		abstractGameState: status.abstractGameState || "",
		detailedState: status.detailedState || "",
		// YYYY-MM-DD -- needed to look up this game's radio broadcasts,
		// which are fetched by DATE (schedule?hydrate=broadcasts), not by
		// gamePk directly. Not present anywhere else in this response.
		officialDate: (gameData.datetime && gameData.datetime.officialDate) || "",
		linescore: GamedayParser.parseLinescore(liveData.linescore),
		plays: GamedayParser.parsePlays(liveData.plays),
		currentAtBat: GamedayParser.parseCurrentAtBatPitches(liveData.plays && liveData.plays.currentPlay),
		matchup: GamedayParser.parseMatchup(liveData.plays && liveData.plays.currentPlay, liveData.linescore, liveData.boxscore)
	};
};
