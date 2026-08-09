// Top-level left-nav entry (see data/localExtras.js's leftnav and
// views/Panels2.js's "panes"/leftNav.itemClicked). Two-pane drill-down,
// same SlidingPane mechanism as mlb.NewsView (views/NewsView.js):
//   pane 1 (mlb.AbsScoreboard) -- the same Scoreboard UI as the main
//                                 Scoreboard tab (mlb.ScoreboardView,
//                                 views/ScoreboardView.js), subclassed
//                                 rather than duplicated, with games
//                                 filtered to already-played only and the
//                                 date floor raised to the 2026 season
//   pane 2 (mlb.AbsGameStats)  -- tapped game's ABS challenge stats: a
//                                 lightweight per-team summary (MLB's own
//                                 feed/live) plus per-pitch challenge
//                                 detail + a plate-location diagram
//                                 (Baseball Savant)
//
// Why this exists at all: the ESPN "2026 MLB ABS challenge system tracker"
// article this used to jump to (see lib/parsers/NewsParser.js's
// PINNED_ARTICLE_*) is prose, not real per-team/per-game data. An earlier
// version of this view had its own hand-rolled team-logo grid + per-team
// game list; replaced per direct user feedback with the real Scoreboard UI
// instead (same look or the user already knows, own logo-loading bugs
// avoided by not re-implementing what mlb.ScoreboardGameBox already does).

// ---------------------------------------------------------------------------
// Pane 1: reuses mlb.ScoreboardView's entire UI/date-nav/fetch pipeline via
// subclassing rather than reimplementing it -- only three behaviors differ:
//   - date floor clamped to the 2026 season (ABS didn't exist before it)
//   - only already-played (Live/Final) games ever get listed
//   - tapping a game goes to ABS stats instead of Gameday
// mlb.ScoreboardList's own tile-tap plumbing (views/ScoreboardList.js)
// already calls the owning view's openGamedayForGame(game) for any
// mlb.ScoreboardGameBox tap -- overriding that one method is the entire
// hook needed; ScoreboardList/ScoreboardGameBox themselves are untouched.
// ---------------------------------------------------------------------------

// Same as mlb.ScoreboardHeader (views/ScoreboardView.js) minus the "live
// look-in audio" button -- that button's popup shows the shared MLB Audio
// feed picker, which has no meaningful role on an ABS stats screen.
enyo.kind({
	name : "mlb.AbsScoreboardHeader",
	kind : "mlb.ScoreboardHeader",
	create : function() {
		this.inherited(arguments);
		this.$.gamedayAudioButton.hide();
	},
	// ABS didn't exist before the 2026 season (see mlb.AbsScoreboard's own
	// getConfigDates) -- there's never a real choice to make on the year,
	// so remove that picker column entirely (enyo.DatePicker's own
	// published hideYear property) rather than just range-limiting it,
	// which would leave it tappable/scrollable but always landing back on
	// the same single value.
	//
	// this.$.datePicker (flat), NOT this.$.Calendar.$.datePicker -- the
	// nested path seemed right by analogy (Popup owning its own declared
	// children) but confirmed live (device log, 2026-08-07) it's undefined
	// even well after Calendar.openAtControl() runs; this app's real
	// on-device Popup/DatePicker apparently don't nest the way the
	// open-source Enyo 1.0 reference implies. Reverted to the flat
	// reference the ORIGINAL calendarButtonClick/calendarChange (see
	// mlb.ScoreboardHeader, views/ScoreboardView.js) already used
	// successfully this whole project.
	//
	// Still not done in create() -- confirmed separately that datePicker
	// doesn't exist yet immediately after this header's own construction
	// (well before the calendar's ever been opened at all), which is what
	// caused the original white-screen-at-launch crash. Deferred one tick
	// past the inherited calendarButtonClick's own openAtControl call via
	// setTimeout, since even right after that call returns synchronously,
	// datePicker may not be attached yet either -- the existence check
	// inside the timeout is real insurance here, not just belt-and-braces.
	calendarButtonClick : function(sender) {
		this.inherited(arguments);
		var self = this;
		setTimeout(function() {
			if (self.$.datePicker) {
				self.$.datePicker.setHideYear(true);
			}
		}, 0);
	}
});

enyo.kind({
	name : "mlb.AbsScoreboard",
	kind : "mlb.ScoreboardView",
	// Leaner than mlb.ScoreboardView's own components -- no scrim/audio
	// popup, since nothing on this view ever triggers them (the only
	// button that could, gamedayAudioButton, is hidden above). Every
	// inherited method this view relies on (changeScoreboardDate,
	// fetchScoreboard, getDateString, ...) only ever reaches its target
	// controls by name via this.$.scoreboardHeader/scroller/scoreboardList/
	// getScoreboard, all still present here under the same names.
	components : [ {
		kind : "enyo.VFlexBox",
		flex : 1,
		components : [ {
			flex : 0,
			name : "scoreboardHeader",
			kind : "mlb.AbsScoreboardHeader"
		}, {
			kind : "Scroller",
			name : "scroller",
			// className scopes css/AbsStatsView.css's own
			// .absScoreboardScroller .scoreboardGamesContainer rule to
			// JUST this view's game grid -- per direct user correction,
			// Scoreboard's own tile alignment was already correct and
			// should never have been touched; only ABS Stats' copy needed
			// adjusting. mlb.ScoreboardGameBox/.scoreboardGamesContainer's
			// shared base CSS (css/ScoreboardView.css) is reverted back to
			// exactly what it was before today's changes -- this extra
			// class is the only thing that makes the two views' grids look
			// different now.
			className : "absScoreboardScroller",
			flex : 1,
			components : [ {
				kind : "mlb.ScoreboardList",
				name : "scoreboardList",
				flex : 1
			} ]
		}, {
			flex : 0,
			kind : "Toolbar",
			height : "40px",
			components : [ {
				kind : "GrabButton"
			} ]
		} ]
	}, {
		name : "getScoreboard",
		kind : "ScoreboardStatsAPIService",
		onSuccess : "scoreboardReturn",
		onFailure : "scoreboardFailed"
	} ],

	// ABS didn't exist before the 2026 regular season -- never let date nav
	// (prev button or the calendar picker) go earlier than opening day,
	// regardless of data/localConfig.js's own deliberately generic
	// firstAllowedDay (2015-01-01, kept generic there so that file doesn't
	// go stale every year -- see its own header comment). This IS
	// season-specific on purpose, unlike that file: confirmed live via MLB
	// Stats API's own seasons endpoint (seasons?sportId=1&season=2026),
	// regularSeasonStartDate 2026-03-25. mlb.ScoreboardHeader's
	// previousButtonClick/selectDate both funnel through the inherited
	// changeScoreboardDate, which already clamps any date earlier than
	// this.configDates.firstAllowedDay up to it -- raising the floor here
	// is the only change needed for both the button and the calendar
	// picker to respect it.
	getConfigDates : function() {
		var dates = this.inherited(arguments);
		var absFloor = new Date(2026, 2, 25); // March 25, 2026
		if (dates.firstAllowedDay.getTime() < absFloor.getTime()) {
			dates.firstAllowedDay = absFloor;
		}
		// Also cap the CEILING to today -- data/localConfig.js's own
		// lastAllowedDay is deliberately generic (2035-12-31, see that
		// file's header comment) so nothing here stops date nav from
		// reaching a future date otherwise. A future date can only ever
		// show Preview games, which scoreboardReturn below already filters
		// out of the list entirely -- capping the date itself, not just the
		// resulting list, is what actually stops the confusing "picked a
		// date, list came back empty" state from being reachable at all.
		// Same UTC-5/DST "today" calculation as mlb.ScoreboardView's own
		// changeScoreboardDate, for consistency.
		var now = new Date();
		var today = bam.datetime.DateTime(now).setTimeZone(-5, bam.datetime.isDST(now));
		if (dates.lastAllowedDay.getTime() > today.getTime()) {
			dates.lastAllowedDay = today;
		}
		return dates;
	},

	// True if this.date is the actual current calendar day (UTC-5, same
	// zone/DST handling as the rest of this view's date math) -- used by
	// scoreboardReturn below to decide whether landing on "today" by
	// default needs redirecting to yesterday.
	isShowingToday : function() {
		if (!this.date) {
			return false;
		}
		var now = new Date();
		var today = bam.datetime.DateTime(now).setTimeZone(-5, bam.datetime.isDST(now));
		return this.date.getFullYear() === today.getFullYear() &&
			this.date.getMonth() === today.getMonth() &&
			this.date.getDate() === today.getDate();
	},

	// Set once the very first load has been checked for a same-day redirect
	// (see scoreboardReturn) -- deliberately never reset, so re-selecting
	// the ABS Stats tab later (or navigating dates by hand) never fights the
	// user's own subsequent navigation.
	initialLoadChecked : false,

	// Never show a not-yet-played game -- ABS challenge data plainly can't
	// exist for a game that hasn't happened yet.
	scoreboardReturn : function(inSender, inResponse) {
		main.hideMiddleSpinner();
		try {
			var parsed = ScoreboardParser.parseScoreboardFromStatsAPI(inResponse);
			var playedGames = [];
			var hasLiveGame = false;
			for (var i = 0; i < parsed.games.length; i++) {
				if (!parsed.games[i].status.isPreview) {
					playedGames.push(parsed.games[i]);
				}
				if (parsed.games[i].status.abstractGameState === "Live") {
					hasLiveGame = true;
				}
			}
			// Per direct user feedback: opening ABS Stats should never
			// default to today unless a game is actually being played
			// right now -- if today has nothing live (nothing started yet,
			// or everything already finished), silently redirect to
			// yesterday instead of showing today's (possibly still-empty)
			// list. Only on the very first load -- changeScoreboardDate
			// below re-triggers this same function, and initialLoadChecked
			// being true by then is what stops it from firing a second time
			// (and from ever overriding date-nav the user does by hand
			// later).
			if (!this.initialLoadChecked) {
				this.initialLoadChecked = true;
				if (!hasLiveGame && this.isShowingToday()) {
					var yesterday = bam.datetime.clone(this.date);
					yesterday.setDate(yesterday.getDate() - 1);
					this.changeScoreboardDate(yesterday);
					return;
				}
			}
			this.$.scoreboardList.setGames(playedGames);
		}
		catch (e) {
			console.log("AbsScoreboard scoreboardReturn parse error: " + e);
			this.$.scoreboardList.setGames([]);
		}
	},

	// The only hook needed to redirect a game tap to ABS stats instead of
	// Gameday -- see file header comment.
	openGamedayForGame : function(game) {
		if (!game || !game.status || game.status.isPreview) {
			return; // defensive; scoreboardReturn above already filters these out
		}
		if (this.owner && this.owner.showGameStats) {
			this.owner.showGameStats(game);
		}
	}
});

// ---------------------------------------------------------------------------
// Pane 2: the tapped game's ABS challenge stats. Two independent fetches:
//  - MLB Stats API's own feed/live (gameData.absChallenges) -- a tiny,
//    already-trusted, already-used-elsewhere-in-this-app summary: per-team
//    successful/failed/remaining challenge counts.
//  - com.mlb.atbat2011.service's getAbsChallengeEvents (see
//    MLBAudioService.js) -- per-pitch challenge detail from Baseball
//    Savant's gf?game_pk= feed, pre-filtered SERVER-SIDE so this app's own
//    WebKit only ever receives the small already-extracted list, never the
//    full multi-MB source payload.
// Both render into one enyo.HtmlContent (allowHtml:true by default) as
// plain constructed HTML strings -- no per-row interactivity needed here,
// so no dynamic per-item components.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.AbsGameStats",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [ {
		name : "header",
		kind : "mlb.GenericWebViewHeader",
		flex : 0
	}, {
		name : "scroller",
		kind : "enyo.Scroller",
		flex : 1,
		className : "absGameStatsScroller",
		components : [ {
			name : "content",
			kind : "enyo.HtmlContent",
			className : "fullArticleView"
		} ]
	}, {
		kind : "Toolbar",
		height : "40px",
		flex : 0,
		components : [ {
			kind : "GrabButton"
		} ]
	}, {
		name : "getFeedLive",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "httpRequest",
		onSuccess : "gotFeedLive",
		onFailure : "feedLiveFailed"
	}, {
		name : "getChallenges",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "getAbsChallengeEvents",
		onSuccess : "gotChallenges",
		onFailure : "challengesFailed"
	} ],

	currentGame : null,
	summaryHtml : "",
	challengesHtml : "",
	pending : 0,
	feedLiveDone : false,
	challengesDone : false,
	// Bumped on every loadGame call -- a late response from an abandoned
	// earlier tap (the user browsed on to another game before it arrived)
	// carries the OLD gamePk in inResponse.echo/inResponse.gamePk (see
	// MLBAudioService.js's httpRequest echo/getAbsChallengeEvents gamePk),
	// which every handler below checks against this.currentGame.gamePk
	// before touching pending/summaryHtml/challengesHtml -- otherwise a
	// stale response could silently overwrite a newer game's already-
	// correct display, or double-decrement pending for a generation it was
	// never part of.
	watchdogTimer : null,

	// isRetry: internal -- true when the watchdog below re-issues a single
	// still-outstanding call after the first 15s timeout instead of giving
	// up immediately. Confirmed live (2026-08-07) that this device's
	// PalmServiceBridge occasionally drops a request with literally no
	// trace at all -- not even a curl spawn on the service side, per
	// /tmp/abs_debug.log showing getChallenges completing normally while
	// getFeedLive's own httpRequest never logged a thing for the same
	// loadGame call -- so a single automatic retry recovers the common
	// case instead of the user having to back out and re-tap the game
	// themselves.
	loadGame : function(game, isRetry) {
		this.currentGame = game;
		this.$.header.$.title.setContent(game.awayTeam.name + " @ " + game.homeTeam.name);
		if (!isRetry) {
			this.summaryHtml = '<div class="articleTitle">Loading...</div>';
			this.challengesHtml = "";
			this.feedLiveDone = false;
			this.challengesDone = false;
			this.renderAll();
			main.showMiddleSpinner();
		}

		this.pending = (this.feedLiveDone ? 0 : 1) + (this.challengesDone ? 0 : 1);
		if (this.watchdogTimer) {
			clearTimeout(this.watchdogTimer);
		}
		var self = this;
		var watchdogGamePk = game.gamePk;
		// Safety net: PalmService's underlying LS2 call has no JS-exposed
		// timeout (see the getFeedLive comment below) -- if either call
		// never resolves at all (a native PalmServiceBridge-level failure,
		// distinct from a normal onFailure callback), pending would stay >0
		// forever and main.hideMiddleSpinner() would never fire. Main.js's
		// spinner is a plain show/hide control, not ref-counted, covering
		// the whole middle pane -- confirmed live 2026-08-07 that this is
		// exactly what "ABS Stats content stopped loading, can't even view
		// games that just worked" looked like: not a per-game data bug, a
		// spinner stuck on from one silently-dropped response, blocking
		// every subsequent tap including previously-good games. Force-
		// completing after a generous timeout guarantees the UI can never
		// get stuck this way again, regardless of root cause.
		this.watchdogTimer = setTimeout(function() {
			if (!self.currentGame || self.currentGame.gamePk !== watchdogGamePk || self.pending <= 0) {
				return;
			}
			if (!isRetry) {
				SportsLogger.log("AbsGameStats", "watchdog: retrying still-missing call(s) once for gamePk=" +
					watchdogGamePk + " (feedLiveDone=" + self.feedLiveDone + " challengesDone=" + self.challengesDone + ")");
				self.watchdogTimer = null;
				self.loadGame(game, true);
				return;
			}
			SportsLogger.log("AbsGameStats", "watchdog: giving up after retry for gamePk=" + watchdogGamePk + ", pending=" + self.pending);
			self.pending = 0;
			if (!self.feedLiveDone) {
				self.summaryHtml = '<div class="articleTitle">ABS Challenges</div><div class="articleBody">No summary available for this game.</div>';
			}
			if (!self.challengesDone) {
				self.challengesHtml = '<div class="articleByLine">No individual challenge detail available for this game.</div>';
			}
			self.renderAll();
			main.hideMiddleSpinner();
		}, 15000);

		if (this.feedLiveDone && this.challengesDone) {
			// Nothing left outstanding to retry (shouldn't normally reach
			// here -- watchdog only re-fires while pending > 0 -- but guards
			// against calling either service a third time for no reason).
			main.hideMiddleSpinner();
			return;
		}

		// MLB Stats API's own "fields" filter -- confirmed live this drops
		// the response from ~820KB down to ~200 bytes (just the couple of
		// fields actually needed here), which matters a lot more than it
		// sounds: PalmService's underlying LS2 call goes through a native
		// PalmServiceBridge object (see enyo's own PalmService.js) with no
		// JS-exposed timeout to raise -- confirmed live that fetching the
		// full unfiltered response caused this call to fail outright with
		// a generic native "Message status unknown" bridge error, most
		// likely this old device's own JSON.parse of an ~800KB string
		// (inside the service, before it could even respond) taking longer
		// than that bridge's own fixed timeout. Shrinking the fetch itself
		// (not just the final response) is the only lever available here.
		if (!this.feedLiveDone) {
			this.$.getFeedLive.call({
				url : "https://statsapi.mlb.com/api/v1.1/game/" + game.gamePk +
					"/feed/live?fields=gameData,status,abstractGameState,absChallenges,hasChallenges,away,home,usedSuccessful,usedFailed,remaining",
				method : "GET",
				echo : game.gamePk
			});
		}
		if (!this.challengesDone) {
			this.$.getChallenges.call({ gamePk : game.gamePk });
		}
	},

	checkDone : function() {
		this.pending--;
		if (this.pending <= 0) {
			if (this.watchdogTimer) {
				clearTimeout(this.watchdogTimer);
				this.watchdogTimer = null;
			}
			main.hideMiddleSpinner();
		}
	},

	// True if a response belongs to whatever game is CURRENTLY loaded --
	// false for a late response from a game the user has since navigated
	// away from. responseGamePk is httpRequest's echoed-back args.echo (a
	// number) for gotFeedLive/feedLiveFailed, or getAbsChallengeEvents' own
	// gamePk field for gotChallenges/challengesFailed -- see
	// MLBAudioService.js. Loosely-typed (==) since one path echoes back
	// whatever type game.gamePk originally was and the other never
	// round-trips through JSON at all.
	isCurrentGame : function(responseGamePk) {
		return !!this.currentGame && responseGamePk != null && responseGamePk == this.currentGame.gamePk;
	},

	gotFeedLive : function(inSender, inResponse) {
		if (!this.isCurrentGame(inResponse && inResponse.echo)) {
			return; // stale response for a game the user has since navigated away from
		}
		var status = inResponse && inResponse.status;
		var isSuccess = status === 0 || (status >= 200 && status < 300);
		var abs = (isSuccess && inResponse.json && inResponse.json.gameData) ? inResponse.json.gameData.absChallenges : null;
		var g = this.currentGame;
		SportsLogger.log("AbsGameStats", "gotFeedLive gamePk=" + g.gamePk + " status=" + status +
			" hasJson=" + !!(inResponse && inResponse.json) +
			" hasGameData=" + !!(inResponse && inResponse.json && inResponse.json.gameData) +
			" abs=" + JSON.stringify(abs) +
			" rawLen=" + ((inResponse && inResponse.raw) ? inResponse.raw.length : -1));
		if (abs && abs.away && abs.home) {
			this.summaryHtml = '<div class="articleTitle">ABS Challenges</div><div class="articleBody">' +
				enyo.string.escapeHtml(g.awayTeam.name) + ": " + abs.away.usedSuccessful + " successful, " +
				abs.away.usedFailed + " failed, " + abs.away.remaining + " remaining<br>" +
				enyo.string.escapeHtml(g.homeTeam.name) + ": " + abs.home.usedSuccessful + " successful, " +
				abs.home.usedFailed + " failed, " + abs.home.remaining + " remaining</div>";
		} else {
			this.summaryHtml = '<div class="articleTitle">ABS Challenges</div><div class="articleBody">No summary available for this game.</div>';
		}
		this.feedLiveDone = true;
		this.renderAll();
		this.checkDone();
	},
	feedLiveFailed : function(inSender, inResponse) {
		if (!this.isCurrentGame(inResponse && inResponse.echo)) {
			return; // stale response for a game the user has since navigated away from
		}
		SportsLogger.log("AbsGameStats", "feedLiveFailed gamePk=" + (this.currentGame && this.currentGame.gamePk) +
			": " + JSON.stringify(inResponse).substring(0, 300));
		this.summaryHtml = '<div class="articleTitle">ABS Challenges</div><div class="articleBody">No summary available for this game.</div>';
		this.feedLiveDone = true;
		this.renderAll();
		this.checkDone();
	},

	gotChallenges : function(inSender, inResponse) {
		if (!this.isCurrentGame(inResponse && inResponse.gamePk)) {
			return; // stale response for a game the user has since navigated away from
		}
		this.challengesDone = true;
		var challenges = (inResponse && inResponse.returnValue && inResponse.challenges) || [];
		SportsLogger.log("AbsGameStats", "gotChallenges gamePk=" + (this.currentGame && this.currentGame.gamePk) +
			" returnValue=" + (inResponse && inResponse.returnValue) +
			" error=" + (inResponse && inResponse.error) +
			" count=" + challenges.length);
		if (!challenges.length) {
			this.challengesHtml = '<div class="articleByLine">No individual challenge detail available for this game.</div>';
		} else {
			// AbsChallengeFormat (lib/parsers/AbsChallengeFormat.js) builds
			// each row -- shared with views/GamedayView.js's
			// mlb.GamedayChallengeDetail, which renders one of these same
			// rows for a single challenge tapped from Gameday's play-by-play.
			var html = '<div class="articleByLine">Challenge Detail</div>';
			for (var i = 0; i < challenges.length; i++) {
				html += AbsChallengeFormat.buildChallengeRowHtml(challenges[i]);
			}
			this.challengesHtml = html;
		}
		this.renderAll();
		this.checkDone();
	},
	challengesFailed : function(inSender, inResponse) {
		if (!this.isCurrentGame(inResponse && inResponse.gamePk)) {
			return; // stale response for a game the user has since navigated away from
		}
		SportsLogger.log("AbsGameStats", "challengesFailed gamePk=" + (this.currentGame && this.currentGame.gamePk) +
			": " + JSON.stringify(inResponse).substring(0, 300));
		this.challengesHtml = '<div class="articleByLine">No individual challenge detail available for this game.</div>';
		this.challengesDone = true;
		this.renderAll();
		this.checkDone();
	},

	renderAll : function() {
		this.$.content.setContent(this.summaryHtml + this.challengesHtml);
	}
});

// ---------------------------------------------------------------------------
// Outer orchestrator -- registered as the "AbsStats" top-level pane (see
// views/Panels2.js and views/Main.js's Views registry).
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.AbsStatsView",
	kind : "SlidingPane",
	flex : 1,
	multiViewMinWidth : 0,
	components : [ {
		name : "scoreboardPane",
		width : "824px",
		components : [ {
			name : "scoreboard",
			kind : "mlb.AbsScoreboard",
			flex : 1
		} ]
	}, {
		name : "gameStatsPane",
		components : [ {
			name : "gameStats",
			kind : "mlb.AbsGameStats",
			flex : 1
		} ]
	} ],

	// Reselecting the AbsStats left-nav tab always resets back to the
	// scoreboard pane, same "always reset to the entry pane" spec as
	// mlb.NewsView.show, and re-shows the scoreboard itself (its own show()
	// re-fetches for whatever date it was last on).
	show : function() {
		this.$.scoreboardPane.select();
		this.$.scoreboard.show();
	},

	showGameStats : function(game) {
		this.$.gameStats.loadGame(game);
		this.$.gameStatsPane.select();
	}
});
