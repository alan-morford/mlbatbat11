// Parses two sources for views/GameSummaryView.js (the post-game "Game
// Summary" screen shown when a user taps a Final game in Scoreboard):
//
//   1. MLB Stats API's own game/{gamePk}/boxscore -- team batting/pitching
//      lines + topPerformers (MLB's own "who mattered in this game" list,
//      gameScore-ranked -- used directly as this view's "Top players"
//      section instead of computing anything ourselves).
//
//   2. ESPN's site.api.espn.com scoreboard response (already fetched
//      elsewhere in this app -- views/VideosView.js's own gotScoreboard --
//      but THAT usage walks backward day-by-day matching on team only,
//      which is deliberately loose (any recent clip for this team). This
//      view needs the opposite: the ONE exact game, so findEventForGame
//      matches on BOTH competitor abbreviations for a SINGLE known date --
//      structurally can't return a different game's highlight/recap the
//      way a team-only search could.
var GameSummaryParser = {};

// --- Boxscore -------------------------------------------------------------

GameSummaryParser.parseBoxscore = function (json) {
	var teams = (json && json.teams) || {};
	return {
		away : GameSummaryParser.parseTeamBox(teams.away),
		home : GameSummaryParser.parseTeamBox(teams.home),
		topPerformers : GameSummaryParser.parseTopPerformers(json && json.topPerformers)
	};
};

GameSummaryParser.parseTeamBox = function (teamBox) {
	teamBox = teamBox || {};
	var players = teamBox.players || {};
	var teamStats = teamBox.teamStats || {};
	return {
		teamName : teamBox.team && teamBox.team.name,
		batters : GameSummaryParser.mapPlayers(teamBox.batters, players, "batting"),
		pitchers : GameSummaryParser.mapPlayers(teamBox.pitchers, players, "pitching"),
		battingTotals : teamStats.batting || null,
		pitchingTotals : teamStats.pitching || null
	};
};

GameSummaryParser.mapPlayers = function (ids, players, statType) {
	var rows = [];
	for (var i = 0; i < (ids || []).length; i++) {
		var p = players["ID" + ids[i]];
		if (!p || !p.person) {
			continue;
		}
		var stat = (p.stats && p.stats[statType]) || null;
		if (!stat || !stat.summary) {
			continue; // e.g. a defensive replacement who never batted/pitched
		}
		rows.push({
			id : p.person.id,
			name : p.person.boxscoreName || p.person.fullName,
			position : p.position && p.position.abbreviation,
			note : stat.note || "",
			summary : stat.summary,
			stat : stat
		});
	}
	return rows;
};

GameSummaryParser.parseTopPerformers = function (raw) {
	var out = [];
	for (var i = 0; i < (raw || []).length; i++) {
		var t = raw[i];
		var player = t.player || {};
		var person = player.person || {};
		var stats = player.stats || {};
		var summary = (stats.pitching && stats.pitching.summary) || (stats.batting && stats.batting.summary) || "";
		if (!person.id || !summary) {
			continue;
		}
		out.push({
			id : person.id,
			name : person.fullName,
			position : player.position && player.position.abbreviation,
			teamId : player.parentTeamId,
			summary : summary
		});
	}
	return out;
};

// --- ESPN scoreboard: exact-game highlight + recap headline ---------------

// espnJson is the raw parsed body of
// site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=YYYYMMDD
// (already fetched for a SPECIFIC date -- see views/GameSummaryView.js's
// getGameDateParam). awayEspnSlug/homeEspnSlug are MLBTeamReference espnSlug
// values (NOT Stats API abbreviation -- see that file's own header comment,
// same ESPN-vs-Stats-API mismatch views/VideosView.js already documents).
// Returns the matching event's competition object, or null if that date's
// slate doesn't include this matchup (shouldn't normally happen since the
// date came from the game itself, but ESPN simply not having posted/covered
// a given game is real and already seen -- see views/VideosView.js's own
// header comment on thin ESPN highlight coverage).
GameSummaryParser.findEventForGame = function (espnJson, awayEspnSlug, homeEspnSlug) {
	var events = (espnJson && espnJson.events) || [];
	for (var i = 0; i < events.length; i++) {
		var comp = events[i].competitions && events[i].competitions[0];
		if (!comp) {
			continue;
		}
		var competitors = comp.competitors || [];
		var slugs = {};
		for (var j = 0; j < competitors.length; j++) {
			var abbr = (competitors[j].team && competitors[j].team.abbreviation) || "";
			slugs[abbr.toLowerCase()] = true;
		}
		if (slugs[(awayEspnSlug || "").toLowerCase()] && slugs[(homeEspnSlug || "").toLowerCase()]) {
			return { event : events[i], competition : comp };
		}
	}
	return null;
};

// Same links.source shape as views/VideosView.js's own gotScoreboard --
// both hlsUrl (the only thing this device can actually play, see
// MLBAudioService.js's downloadEspnVideoHls) and mp4Url (kept only as the
// "does a playable source exist at all" check, same as that file) must be
// present or there's no usable clip.
GameSummaryParser.extractHighlight = function (competition) {
	var hi = competition && competition.highlights && competition.highlights[0];
	if (!hi) {
		return null;
	}
	var source = hi.links && hi.links.source;
	var mp4Url = source && ((source.HD && source.HD.href) || source.href);
	var hlsUrl = source && source.HLS && source.HLS.href;
	if (!mp4Url || !hlsUrl || !hi.id) {
		return null;
	}
	return {
		id : hi.id,
		headline : hi.headline || "",
		thumbnail : hi.thumbnail || "",
		duration : hi.duration,
		mp4Url : mp4Url,
		hlsUrl : hlsUrl,
		// Playback goes through metube.webosarchive.org, not hlsUrl directly
		// -- see MLBAudioService.js's downloadEspnVideoViaMetube and
		// views/VideosView.js's own gotScoreboard for why (identical
		// reasoning/URL shape, kept in sync deliberately).
		clipUrl : "https://www.espn.com/video/clip/_/id/" + hi.id
	};
};

// The event-level "recap" link (rel:["recap","desktop","event"]) is the
// SAME url ESPN's own news feed uses for this game's Recap-type article
// (confirmed live, 2026-08-09: identical href in both places) -- which is
// exactly the article views/NewsView.js's own team news list would show for
// either of this game's two teams, so no separate per-team news fetch is
// needed. headline text comes from the scoreboard competition's own
// headlines[0] (shortLinkText, ESPN's own display-ready recap headline).
GameSummaryParser.extractRecap = function (event, competition) {
	var links = (event && event.links) || [];
	var recapHref = null;
	for (var i = 0; i < links.length; i++) {
		var rel = links[i].rel || [];
		for (var j = 0; j < rel.length; j++) {
			if (rel[j] === "recap") {
				recapHref = links[i].href;
				break;
			}
		}
		if (recapHref) {
			break;
		}
	}
	if (!recapHref) {
		return null;
	}
	var headlineObj = competition && competition.headlines && competition.headlines[0];
	var title = (headlineObj && (headlineObj.shortLinkText || headlineObj.description)) || "Game Recap";
	return { title : title, link : recapHref };
};
