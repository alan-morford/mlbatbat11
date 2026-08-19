// "Game Summary" -- shown instead of the live Gameday view when a user taps
// a game in Scoreboard (views/ScoreboardView.js's openGamedayForGame) that's
// already Final. Score, top performers, box score, the highlight clip (if
// ESPN has posted one for this exact game), and this game's recap headline
// -- with a button to reach a full-width play-by-play pane (own linescore +
// the complete play list, tapped challenges opening their own detail pane)
// for anyone who wants it.
//
// Two levels of nested 2-pane SlidingPane (a tapped challenge's detail used
// to be a third, innermost level -- now a popup instead, see
// mlb.GameSummaryPlayByPlay below), each mirroring an ALREADY-PROVEN exact
// shape elsewhere in this app rather than one flat multi-pane SlidingPane --
// deliberately, since this app has no on-device console and SlidingPane's
// own drag/swipe-back behavior for a direct, never-visited-intermediate-pane
// jump (e.g. selecting a 3rd sibling pane straight from the 1st) isn't
// something that could be confirmed correct by reading framework source
// alone. Every transition below is instead a straight copy of one of these
// two already-shipped, confirmed-working shapes:
//   - views/NewsView.js's mlb.NewsView (articleListPane <-> articlePane,
//     peekWidth 412) -- copied by mlb.GameSummaryPane below (mainPane <->
//     articlePane) for the "Game Story" headline's article overlay.
//   - The 2-pane SlidingPane shape views/GamedayView.js's own mlb.GamedayPane
//     used before its challenge pane was replaced with a popup (no peekWidth)
//     -- copied by mlb.GameSummaryView below (mainPane <-> playByPlayPane)
//     for the Play-by-Play button.
//
// Nesting, outermost to innermost:
//   mlb.GameSummaryPane (registered as "GameSummary", views/Panels2.js/
//                         views/Main.js -- see that file's own header
//                         comment on why NOT in data/localExtras.js's
//                         leftnav)
//     -> mainPane: mlb.GameSummaryView
//          -> mainPane: mlb.GameSummaryContent (score/video/top players/
//             "Game Story" link/box score -- everything this file
//             originally was, before this restructuring)
//          -> playByPlayPane: mlb.GameSummaryPlayByPlay (own linescore +
//             full-width mlb.GamedayPlayByPlay list via
//             mlb.GameSummaryPlayByPlayContent, reused as-is, plus
//             mlb.GamedayChallengeDetail -- a self-contained ModalDialog --
//             for a tapped challenge's detail)
//     -> articlePane: mlb.ArticleReaderView (reused as-is -- same kind
//        views/NewsView.js's own article pane uses)
//
// Data sources:
//   - MLB Stats API's own game/{gamePk}/boxscore (GameBoxscoreAPIService,
//     lib/WebServices.js) -- team batting/pitching lines AND topPerformers
//     (MLB's own gameScore-ranked "who mattered" list, used directly rather
//     than computing anything ourselves). See lib/parsers/
//     GameSummaryParser.js.
//   - ESPN's scoreboard endpoint (site.api.espn.com/.../mlb/scoreboard
//     ?dates=YYYYMMDD), same endpoint views/VideosView.js already uses, but
//     matched EXACTLY (both competitor abbreviations, for the one date this
//     game was actually played) via GameSummaryParser.findEventForGame --
//     not the looser "any recent clip for this team" search VideosView does
//     for browsing, which could otherwise surface a different, earlier
//     game's highlight for the same team. The date comes from converting
//     this game's own gameDate (UTC first-pitch time) to Eastern via the
//     same bam.datetime.DateTime(...).setTimeZone(-5, bam.datetime.isDST())
//     call views/ScoreboardView.js's own changeScoreboardDate already uses,
//     not a second network round-trip just to look up officialDate.
//
// Video playback overlay/services below are a DELIBERATE near-verbatim
// duplication of views/VideosView.js's own playbackOverlay/downloadVideo/
// checkStatus/launchVideoPlayer/showPlaybackOverlay/hidePlaybackOverlay/
// cancelPlayback/startPolling/stopPolling/gotStatus/videoPlayerLaunched
// machinery, NOT a shared/refactored-out kind -- that pipeline is real,
// hard-won, fragile working code (see this project's own
// mlbatbat_video_playback_platform_limit memory on how many times it broke
// on small changes); refactoring VideosView.js itself to share it here
// risked regressing a feature already confirmed working on real hardware,
// for a very small amount of duplicated code. Reuses the exact same CSS
// classes (css/VideosView.css's .videoPlaybackOverlay etc.) rather than
// duplicating those too, since a class name has none of that risk.
enyo.kind({
	name : "mlb.GameSummaryHeader",
	kind : "Header",
	components : [ {
		kind : "enyo.HFlexBox",
		flex : 1,
		align : "center",
		components : [
			{
				kind : "CustomButton",
				name : "backButton",
				className : "gamedayBackButton",
				onclick : "backClicked",
				caption : "< Scoreboard"
			},
			{ name : "matchup", className : "gamedayMatchup", flex : 1 },
			{
				kind : "CustomButton",
				name : "playByPlayButton",
				className : "gameSummaryPlayByPlayButton",
				onclick : "playByPlayClicked",
				caption : "Play-by-Play"
			}
		]
	} ],
	backClicked : function () {
		this.owner.backToScoreboard();
	},
	playByPlayClicked : function () {
		this.owner.openPlayByPlay();
	},
	setMatchup : function (text) {
		this.$.matchup.setContent(text);
	}
});

// One row in the "Top Players" list. Same headshot CDN/aspect-ratio fix as
// views/AbsTeamsView.js's mlb.AbsPlayerRow (33x50, real 213:320 ratio) --
// duplicated per this codebase's own established convention for a small
// local helper (see that file's own header comment on getHeadshotUrl).
enyo.kind({
	name : "mlb.GameSummaryPerformerRow",
	kind : "enyo.HFlexBox",
	align : "center",
	className : "gameSummaryPerformerRow",
	components : [
		{ name : "headshot", kind : "Image", className : "gameSummaryPerformerHeadshot" },
		{ kind : "enyo.VFlexBox", flex : 1, components : [
			{ name : "name", className : "gameSummaryPerformerName" },
			{ name : "summary", className : "gameSummaryPerformerSummary" }
		] }
	],
	setPerformer : function (p) {
		this.$.headshot.setSrc(this.getHeadshotUrl(p.id));
		this.$.name.setContent(p.name + (p.position ? (" (" + p.position + ")") : ""));
		this.$.summary.setContent(p.summary);
	},
	getHeadshotUrl : function (id) {
		return "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/"
			+ id + "/headshot/67/current";
	}
});

enyo.kind({
	name : "mlb.GameSummaryContent",
	kind : "enyo.VFlexBox",
	flex : 1,
	className : "gameSummaryContent",
	components : [ {
		name : "header",
		kind : "mlb.GameSummaryHeader",
		flex : 0
	}, {
		name : "scroller",
		kind : "enyo.Scroller",
		flex : 1,
		components : [
			{
				name : "linescoreWrap",
				className : "gameSummaryLinescoreWrap",
				components : [ { name : "linescore", kind : "mlb.GamedayLinescore" } ]
			},
			{
				className : "gameSummarySection",
				kind : "enyo.HFlexBox",
				components : [
					{
						name : "videoCol",
						className : "gameSummaryVideoCol",
						flex : 0,
						components : [
							{ className : "gameSummarySectionHeader", content : "Highlight Video" },
							{
								name : "videoTile",
								className : "gameSummaryVideoTile",
								showing : false,
								onclick : "videoTileClicked",
								components : [
									{ name : "videoThumb", kind : "Image", className : "gameSummaryVideoThumb" },
									{ name : "videoHeadline", className : "gameSummaryVideoHeadline" }
								]
							},
							{
								name : "videoUnavailable",
								kind : "enyo.VFlexBox",
								className : "gameSummaryVideoUnavailable",
								align : "center",
								pack : "center",
								showing : false,
								components : [
									{ className : "gameSummaryVideoUnavailableText",
										content : "Highlight video coming soon. Check back later." }
								]
							}
						]
					},
					{
						name : "performersCol",
						className : "gameSummaryPerformersCol",
						flex : 1,
						components : [
							{ className : "gameSummarySectionHeader", content : "Top Players" },
							{ name : "topPerformersList", kind : "enyo.VFlexBox" }
						]
					}
				]
			},
			{
				className : "gameSummarySection",
				components : [
					{ className : "gameSummarySectionHeader", content : "Game Story" },
					{ name : "recapHeadline", className : "gameSummaryRecapHeadline", showing : false, onclick : "recapClicked" }
				]
			},
			{
				className : "gameSummarySection",
				components : [
					{ className : "gameSummarySectionHeader", content : "Box Score" },
					{ name : "boxScoreContent", kind : "enyo.HtmlContent", className : "gameSummaryBoxScoreContent" }
				]
			}
		]
	}, {
		// See file header comment -- deliberate near-duplicate of
		// views/VideosView.js's own playbackOverlay, reusing its CSS classes.
		name : "playbackOverlay",
		kind : "enyo.VFlexBox",
		className : "videoPlaybackOverlay",
		flex : 0,
		align : "center",
		pack : "center",
		showing : false,
		onclick : "_swallowClick",
		components : [
			{ kind : "SpinnerLarge" },
			{ name : "playbackStatus", className : "videoPlaybackStatusText", content : "" },
			{ kind : "Button", className : "videoPlaybackCancelButton", caption : "Cancel", onclick : "cancelPlayback" }
		]
	}, {
		name : "getBoxscore",
		kind : "GameBoxscoreAPIService",
		onSuccess : "gotBoxscore",
		onFailure : "boxscoreFailed"
	}, {
		name : "getLinescore",
		kind : "GameLinescoreAPIService",
		onSuccess : "gotLinescore",
		onFailure : "linescoreFailed"
	}, {
		name : "getEspnScoreboard",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "httpRequest",
		onSuccess : "gotEspnScoreboard",
		onFailure : "espnScoreboardFailed"
	}, {
		name : "downloadVideo",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "downloadEspnVideoHls",
		onSuccess : "downloadStarted",
		onFailure : "downloadFailed"
	}, {
		name : "checkStatus",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "getEspnVideoDownloadStatus",
		onSuccess : "gotStatus",
		onFailure : "statusCheckFailed"
	}, {
		name : "launchVideoPlayer",
		kind : "PalmService",
		service : "palm://com.palm.applicationManager/",
		method : "launch",
		onSuccess : "videoPlayerLaunched",
		onFailure : "videoPlayerLaunchFailed"
	} ],

	game : null,
	currentHighlight : null,
	currentRecap : null,

	// --- Entry point -- called from views/ScoreboardView.js's
	// openGamedayForGame BEFORE main.showViewInMiddle, same calling
	// convention as Views["Gameday"].setGame. ---
	setGame : function (game) {
		this.game = game;
		this.currentHighlight = null;
		this.currentRecap = null;

		this.$.header.setMatchup(game.awayTeam.name + " @ " + game.homeTeam.name);

		this.$.getLinescore.urlParams = { gamePk : game.gamePk };
		this.$.getLinescore.call();

		this.$.videoTile.hide();
		this.$.videoUnavailable.hide();
		this.$.recapHeadline.hide();
		this.$.topPerformersList.destroyComponents();
		this.$.topPerformersList.render();
		this.$.boxScoreContent.setContent('<div class="gameSummaryLoading">Loading box score...</div>');
		this.$.scroller.scrollTo(0, 0);

		this.$.getBoxscore.urlParams = { gamePk : game.gamePk };
		this.$.getBoxscore.call();

		this.fetchEspnData(game);
	},

	backToScoreboard : function () {
		main.showViewInMiddle("Scoreboard", Views.Scoreboard);
	},

	// One-hop forward to mlb.GameSummaryView (this kind's own owner), which
	// owns playByPlayPane and has this.game already -- same "one hop per
	// level" forwarding style already established in this app (see
	// views/GamedayView.js's mlb.GamedayLive.challengeTapped/
	// mlb.GamedayView.showChallengeDetail chain).
	openPlayByPlay : function () {
		if (this.owner && this.owner.openPlayByPlay) {
			this.owner.openPlayByPlay();
		}
	},

	// --- Linescore (MLB Stats API) -- same mlb.GamedayLinescore widget
	// views/GamedayView.js's live view uses, fed via the same
	// GamedayParser.parseLinescore shape (see lib/WebServices.js's own
	// comment on why the dedicated linescore endpoint, not feed/live, is the
	// source here). absChallenges intentionally omitted (null) -- that's a
	// separate fetch (com.mlb.atbat2011.service's getAbsChallengeEvents,
	// see views/AbsStatsView.js's mlb.AbsGameStats) this view has no other
	// reason to make; the widget already renders a plain "—" for that
	// column when null. ---

	gotLinescore : function (inSender, inResponse) {
		try {
			var linescore = GamedayParser.parseLinescore(inResponse);
			this.$.linescore.setLinescore(linescore, this.game.awayTeam.name, this.game.homeTeam.name, null);
			// mlb.GamedayLinescore's own "situation" line (count/outs) is
			// built for a still-live game -- this endpoint's currentInning/
			// balls/strikes/outs are just whatever they were at the final
			// out, so setLinescore would otherwise render something like
			// "Top 9 | 2-2, 3 out" under an already-final score. Overwritten
			// directly here (reaching into the child kind's own $ namespace,
			// same as e.g. this.$.header.$.matchup elsewhere in this app)
			// rather than teaching that shared, live-game-focused widget
			// about a Final state itself.
			this.$.linescore.$.situation.setContent("Final");
		} catch (e) {
			console.log("GameSummary gotLinescore parse error: " + e);
		}
	},
	linescoreFailed : function () {},

	// --- Box score / top performers (MLB Stats API) ---

	gotBoxscore : function (inSender, inResponse) {
		try {
			var data = GameSummaryParser.parseBoxscore(inResponse);
			this.renderTopPerformers(data.topPerformers);
			this.renderBoxScore(data);
		} catch (e) {
			console.log("GameSummary gotBoxscore parse error: " + e);
			this.$.boxScoreContent.setContent('<div class="gameSummaryLoading">Box score unavailable.</div>');
		}
	},
	boxscoreFailed : function () {
		this.$.boxScoreContent.setContent('<div class="gameSummaryLoading">Box score unavailable.</div>');
	},

	renderTopPerformers : function (list) {
		this.$.topPerformersList.destroyComponents();
		if (!list || !list.length) {
			this.$.topPerformersList.createComponent({ className : "gameSummaryLoading", content : "No top performers available." });
		} else {
			for (var i = 0; i < list.length; i++) {
				var row = this.$.topPerformersList.createComponent({ kind : "mlb.GameSummaryPerformerRow" });
				row.setPerformer(list[i]);
			}
		}
		this.$.topPerformersList.render();
	},

	renderBoxScore : function (data) {
		this.$.boxScoreContent.setContent(this.buildTeamBoxHtml(data.away) + this.buildTeamBoxHtml(data.home));
	},
	buildTeamBoxHtml : function (teamBox) {
		var html = '<div class="gameSummaryBoxTeamName">' + enyo.string.escapeHtml(teamBox.teamName || "") + '</div>';
		html += this.buildStatTable(teamBox.batters, teamBox.battingTotals, true);
		html += this.buildStatTable(teamBox.pitchers, teamBox.pitchingTotals, false);
		return html;
	},
	// Same "raw HTML string via enyo.HtmlContent" technique as
	// views/AbsTeamsView.js's mlb.AbsPlayerStats.renderTable -- plain
	// tabular data, no per-row interactivity needed here either.
	buildStatTable : function (rows, totals, isBatting) {
		if (!rows || !rows.length) {
			return "";
		}
		var html = '<table class="gameSummaryBoxTable"><tr><th class="gameSummaryBoxNameCol">' +
			(isBatting ? "Batting" : "Pitching") + '</th>' +
			(isBatting ?
				'<th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th>' :
				'<th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th>') +
			'</tr>';
		for (var i = 0; i < rows.length; i++) {
			html += this.buildStatRow(rows[i], isBatting);
		}
		if (totals) {
			html += this.buildStatRow({ name : "Totals", stat : totals }, isBatting, true);
		}
		html += '</table>';
		return html;
	},
	buildStatRow : function (r, isBatting, isTotals) {
		var s = r.stat || {};
		var nameCell = enyo.string.escapeHtml(r.name || "") +
			(r.position ? (' <span class="gameSummaryBoxPos">' + enyo.string.escapeHtml(r.position) + '</span>') : '') +
			(r.note ? (' <span class="gameSummaryBoxNote">' + enyo.string.escapeHtml(r.note) + '</span>') : '');
		var cells = isBatting ?
			[ s.atBats, s.runs, s.hits, s.rbi, s.baseOnBalls, s.strikeOuts ] :
			[ s.inningsPitched, s.hits, s.runs, s.earnedRuns, s.baseOnBalls, s.strikeOuts ];
		var row = '<tr' + (isTotals ? ' class="gameSummaryBoxTotalsRow"' : '') + '><td class="gameSummaryBoxNameCol">' + nameCell + '</td>';
		for (var i = 0; i < cells.length; i++) {
			row += '<td>' + ((cells[i] === undefined || cells[i] === null) ? "" : cells[i]) + '</td>';
		}
		row += '</tr>';
		return row;
	},

	// --- ESPN scoreboard: exact-game highlight + recap headline ---

	// Eastern-calendar-date conversion, NOT a naive UTC slice -- a night
	// game's gameDate (UTC first pitch) can already be the next UTC day, and
	// ESPN buckets its own scoreboard by the game's actual scheduled
	// (Eastern) date, same as MLB's own officialDate does. Reuses the exact
	// same bam.datetime call views/ScoreboardView.js's own
	// changeScoreboardDate already relies on for its "today" calculation,
	// rather than adding a second network round-trip just to ask MLB Stats
	// API for officialDate directly.
	fetchEspnData : function (game) {
		var d = new Date(game.gameDate);
		var eastern = bam.datetime.DateTime(d).setTimeZone(-5, bam.datetime.isDST(d));
		var yyyy = eastern.getFullYear(),
			mm = ("0" + (eastern.getMonth() + 1)).slice(-2),
			dd = ("0" + eastern.getDate()).slice(-2);
		var url = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=" + yyyy + mm + dd;
		this.$.getEspnScoreboard.call({ url : url, method : "GET" });
	},

	gotEspnScoreboard : function (inSender, inResponse) {
		var status = inResponse && inResponse.status;
		var isSuccess = status === 0 || (status >= 200 && status < 300);
		if (!isSuccess || !inResponse.json || !this.game) {
			this.showVideoUnavailable();
			return;
		}
		try {
			var awayRef = MLBTeamReference.getById(this.game.awayTeam.id);
			var homeRef = MLBTeamReference.getById(this.game.homeTeam.id);
			var found = GameSummaryParser.findEventForGame(inResponse.json,
				awayRef && awayRef.espnSlug, homeRef && homeRef.espnSlug);
			if (!found) {
				this.showVideoUnavailable();
				return;
			}
			var highlight = GameSummaryParser.extractHighlight(found.competition);
			if (highlight) {
				this.currentHighlight = highlight;
				this.$.videoThumb.setSrc(highlight.thumbnail);
				this.$.videoHeadline.setContent(highlight.headline);
				this.$.videoTile.show();
				this.$.videoUnavailable.hide();
			} else {
				this.showVideoUnavailable();
			}
			var recap = GameSummaryParser.extractRecap(found.event, found.competition);
			if (recap) {
				this.currentRecap = recap;
				this.$.recapHeadline.setContent(recap.title);
				this.$.recapHeadline.show();
			} else {
				this.$.recapHeadline.hide();
			}
		} catch (e) {
			console.log("GameSummary gotEspnScoreboard parse error: " + e);
			this.showVideoUnavailable();
		}
	},
	espnScoreboardFailed : function () {
		this.showVideoUnavailable();
	},
	showVideoUnavailable : function () {
		this.$.videoTile.hide();
		this.$.videoUnavailable.show();
	},

	// Opens the article in mlb.GameSummaryPane's OWN articlePane (a local
	// slide-over, swipeable back to this same Summary) -- NOT
	// views/NewsView.js's global News view. An earlier version routed
	// through Views["News"].showArticle + main.showViewInMiddle("News",...)
	// instead; that had two problems, confirmed live 2026-08-09: (1) call
	// order mattered (mlb.NewsView.show() unconditionally resets back to its
	// own article list every time News is entered, so showArticle had to
	// run AFTER showViewInMiddle, not before) and (2) even once ordered
	// correctly, it left the GameSummary entirely and landed in the real
	// News tab, with no way back to this Summary except re-tapping the game
	// from Scoreboard again -- not the "pane on top of the summary, swipe
	// away to go back" behavior wanted. Two hops up (this.owner ==
	// mlb.GameSummaryView, ITS owner == mlb.GameSummaryPane, which owns
	// articlePane) -- see mlb.GameSummaryView.showArticle just below.
	recapClicked : function () {
		if (!this.currentRecap || !this.owner || !this.owner.showArticle) {
			return;
		}
		this.owner.showArticle({ title : this.currentRecap.title, link : this.currentRecap.link });
	},

	// --- Playback -- see file header comment on why this duplicates
	// views/VideosView.js's own machinery instead of sharing it. ---

	_cancelled : false,
	downloading : false,
	playingId : null,
	pollTimer : null,
	pollAttempts : 0,
	MAX_POLL_ATTEMPTS : 150,

	videoTileClicked : function () {
		if (this.currentHighlight) {
			this.playClip(this.currentHighlight);
		}
	},
	isCurrentClip : function (id) {
		return !!this.currentHighlight && this.currentHighlight.id === id && this.playingId === id;
	},
	// clipUrl (ESPN clip page url), NOT clip.hlsUrl -- routed through
	// metube.webosarchive.org as of 2026-08-09, same as
	// views/VideosView.js's own playClip; see
	// MLBAudioService.js's downloadEspnVideoViaMetube for why.
	playClip : function (clip) {
		if (!clip.clipUrl || this.downloading) {
			return;
		}
		this._cancelled = false;
		this.downloading = true;
		this.playingId = clip.id;
		this.pollAttempts = 0;
		this.showPlaybackOverlay("Preparing video...");
		this.$.downloadVideo.call({ clipUrl : clip.clipUrl, jobId : clip.id });
	},
	showPlaybackOverlay : function (statusText) {
		this.$.playbackStatus.setContent(statusText);
		this.$.playbackOverlay.show();
		main.setLeftNavBlocked(true);
	},
	hidePlaybackOverlay : function () {
		this.$.playbackOverlay.hide();
		main.setLeftNavBlocked(false);
	},
	cancelPlayback : function () {
		this._cancelled = true;
		this.stopPolling();
		this.downloading = false;
		this.hidePlaybackOverlay();
	},
	downloadStarted : function (inSender, inResponse) {
		if (this._cancelled || !this.isCurrentClip(this.playingId)) {
			return;
		}
		if (!inResponse || !inResponse.returnValue) {
			this.downloading = false;
			this.showPlaybackOverlay("Couldn't start the download.");
			return;
		}
		this.showPlaybackOverlay("Now Loading...");
		this.startPolling();
	},
	downloadFailed : function () {
		if (this._cancelled || !this.isCurrentClip(this.playingId)) {
			return;
		}
		this.downloading = false;
		this.showPlaybackOverlay("Couldn't start the download.");
	},
	startPolling : function () {
		var self = this;
		var pollingId = this.playingId;
		this.stopPolling();
		this.pollTimer = setInterval(function () {
			self.pollAttempts++;
			if (self.pollAttempts > self.MAX_POLL_ATTEMPTS) {
				self.stopPolling();
				self.downloading = false;
				if (!self._cancelled && self.isCurrentClip(pollingId)) {
					self.showPlaybackOverlay("Timed out preparing the video.");
				}
				return;
			}
			self.$.checkStatus.call({ jobId : pollingId });
		}, 2000);
	},
	stopPolling : function () {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	},
	gotStatus : function (inSender, inResponse) {
		if (this._cancelled || !this.isCurrentClip(this.playingId)) {
			return;
		}
		if (!inResponse || !inResponse.returnValue) {
			return;
		}
		if (inResponse.status === "ready") {
			this.stopPolling();
			this.showPlaybackOverlay("Launching player...");
			this.$.launchVideoPlayer.call({
				id : "com.palm.app.videoplayer",
				params : { target : inResponse.playUrl, videoTitle : this.currentHighlight.headline }
			});
		} else if (inResponse.status === "failed") {
			this.stopPolling();
			this.downloading = false;
			this.showPlaybackOverlay("Download failed: " + (inResponse.error || "unknown error"));
		} else {
			var pct = (typeof inResponse.progress === "number" && inResponse.progress > 0) ?
				(" " + inResponse.progress + "%") : "";
			this.showPlaybackOverlay("Now Loading..." + pct);
		}
	},
	statusCheckFailed : function () {},
	videoPlayerLaunched : function () {
		this.downloading = false;
		this.hidePlaybackOverlay();
	},
	videoPlayerLaunchFailed : function (inSender, inResponse) {
		this.downloading = false;
		if (!this._cancelled) {
			this.showPlaybackOverlay("Couldn't launch the video player: " + JSON.stringify(inResponse).substring(0, 200));
		}
	},
	_swallowClick : function () {
		return true;
	}
});

// ---------------------------------------------------------------------------
// Play-by-play pane content -- own linescore (fed off the SAME feed/live
// fetch this needs anyway for the play list, unlike mlb.GameSummaryContent's
// linescore above, which has no other reason to fetch feed/live and uses
// the small dedicated linescore endpoint instead) + the full-width play
// list, reusing views/GamedayPlayByPlay.js's mlb.GamedayPlayByPlay exactly
// as views/GamedayView.js's own live view does. A tapped challenged play
// forwards one hop to mlb.GameSummaryPlayByPlay (this kind's own owner --
// see mlb.GamedayPlayByPlay.playItemClick's own header comment on this
// exact "this.owner.challengeTapped" contract).
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.GameSummaryPlayByPlayContent",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [
		{
			kind : "Header",
			flex : 0,
			components : [ {
				kind : "enyo.HFlexBox",
				flex : 1,
				align : "center",
				components : [
					{
						kind : "CustomButton",
						name : "backButton",
						className : "gamedayBackButton",
						onclick : "backClicked",
						caption : "< Summary"
					},
					{ className : "gameSummaryPlayByPlayTitle", content : "Play-by-Play", flex : 1 }
				]
			} ]
		},
		{
			name : "linescoreWrap",
			className : "gameSummaryLinescoreWrap",
			components : [ { name : "linescore", kind : "mlb.GamedayLinescore" } ]
		},
		{
			name : "scroller",
			kind : "enyo.Scroller",
			flex : 1,
			components : [ { name : "playByPlay", kind : "mlb.GamedayPlayByPlay", flex : 1 } ]
		},
		{
			name : "getGame",
			kind : "GamedayStatsAPIService",
			onSuccess : "gotGame",
			onFailure : "gameFailed"
		}
	],

	gamePk : null,
	awayTeamName : "",
	homeTeamName : "",

	loadGame : function (gamePk, awayTeamName, homeTeamName) {
		this.gamePk = gamePk;
		this.awayTeamName = awayTeamName;
		this.homeTeamName = homeTeamName;
		this.$.playByPlay.setPlays([]);
		this.$.getGame.urlParams = { gamePk : gamePk };
		this.$.getGame.call();
	},
	gotGame : function (inSender, inResponse) {
		try {
			var parsed = GamedayParser.parseGameFeed(inResponse);
			this.$.linescore.setLinescore(parsed.linescore, this.awayTeamName, this.homeTeamName, parsed.absChallenges);
			// Same reasoning as mlb.GameSummaryContent's own gotLinescore --
			// this is a Final game, so the live count/outs the widget would
			// otherwise render is stale/meaningless.
			this.$.linescore.$.situation.setContent("Final");
			this.$.playByPlay.setPlays(parsed.plays);
		} catch (e) {
			console.log("GameSummaryPlayByPlayContent gotGame parse error: " + e);
		}
	},
	gameFailed : function () {
		console.log("GameSummaryPlayByPlayContent gotGame failed for gamePk=" + this.gamePk);
	},
	challengeTapped : function (play) {
		if (this.owner && this.owner.showChallengeDetail) {
			this.owner.showChallengeDetail(this.gamePk, play);
		}
	},
	// Explicit button, NOT swipe -- an earlier version relied on a
	// GrabButton here, but confirmed live (2026-08-09) it didn't work: this
	// content sat inside mlb.GameSummaryPlayByPlay's OWN inner SlidingPane
	// at the time (since removed -- see that kind's own header comment), and
	// a GrabButton here bound to THAT nearest-enclosing SlidingPane instead
	// of the OUTER mlb.GameSummaryView SlidingPane that actually controls
	// mainPane<->playByPlayPane. Two hops up (this.owner ==
	// mlb.GameSummaryPlayByPlay, ITS owner == mlb.GameSummaryView, which
	// owns mainPane) sidesteps that scoping issue entirely regardless of
	// nesting, so this stayed a button even after the inner SlidingPane
	// itself went away.
	backClicked : function () {
		if (this.owner && this.owner.backToSummary) {
			this.owner.backToSummary();
		}
	}
});

// Hosts mlb.GameSummaryPlayByPlayContent plus mlb.GamedayChallengeDetail
// (views/GamedayView.js -- a self-contained ModalDialog, reused unchanged;
// see that kind's own header comment) for a tapped challenged play's detail.
// Used to be a 2-pane SlidingPane (mainPane <-> challengePane) mirroring
// views/GamedayView.js's own now-removed mlb.GamedayPane; converted to a
// popup for the same reason that one was (a whole extra pane wasted too much
// screen space for one challenge's worth of text). mlb.GamedayChallengeDetail
// manages its own open/close/scrim -- nothing extra needed here beyond
// declaring it and forwarding the tapped play to loadChallenge.
enyo.kind({
	name : "mlb.GameSummaryPlayByPlay",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [
		{ name : "content", kind : "mlb.GameSummaryPlayByPlayContent", flex : 1 },
		{ name : "challengeDetail", kind : "mlb.GamedayChallengeDetail" }
	],
	setGame : function (gamePk, awayTeamName, homeTeamName) {
		this.$.content.loadGame(gamePk, awayTeamName, homeTeamName);
	},
	showChallengeDetail : function (gamePk, play) {
		this.$.challengeDetail.loadChallenge(gamePk, play);
	},
	// One-hop forward to mlb.GameSummaryView (this kind's own owner), which
	// owns mainPane -- see mlb.GameSummaryPlayByPlayContent's own
	// backClicked, the actual originator.
	backToSummary : function () {
		if (this.owner && this.owner.backToSummary) {
			this.owner.backToSummary();
		}
	}
});

// 2-pane SlidingPane (mainPane <-> playByPlayPane). Owns `game` so
// openPlayByPlay (forwarded one hop from mlb.GameSummaryContent's header
// button) doesn't need it passed through the click-handler chain.
enyo.kind({
	name : "mlb.GameSummaryView",
	kind : "SlidingPane",
	flex : 1,
	multiViewMinWidth : 0,
	components : [
		{ name : "mainPane", components : [ { name : "content", kind : "mlb.GameSummaryContent", flex : 1 } ] },
		{ name : "playByPlayPane", components : [ { name : "playByPlay", kind : "mlb.GameSummaryPlayByPlay", flex : 1 } ] }
	],
	game : null,
	setGame : function (game) {
		this.game = game;
		this.$.mainPane.select();
		this.$.content.setGame(game);
	},
	// Real implementation -- selects mainPane, sliding playByPlayPane back
	// out of the way. See mlb.GameSummaryPlayByPlayContent's own backClicked
	// header comment for why this is an explicit button chain rather than
	// swipe/GrabButton.
	backToSummary : function () {
		this.$.mainPane.select();
	},
	openPlayByPlay : function () {
		if (!this.game) {
			return;
		}
		this.$.playByPlayPane.select();
		this.$.playByPlay.setGame(this.game.gamePk, this.game.awayTeam.name, this.game.homeTeam.name);
	},
	// One-hop forward to mlb.GameSummaryPane (this kind's own owner), which
	// owns the article overlay pane -- see mlb.GameSummaryContent's own
	// recapClicked, the actual originator.
	showArticle : function (article) {
		if (this.owner && this.owner.showArticle) {
			this.owner.showArticle(article);
		}
	}
});

// ---------------------------------------------------------------------------
// Outermost pane -- registered as the "GameSummary" top-level pane (see
// views/Panels2.js/views/Main.js). 2-pane SlidingPane, exact same shape as
// views/NewsView.js's own mlb.NewsView (articleListPane <-> articlePane,
// same peekWidth/fixedWidth/width values, same mlb.ArticleReaderView reused
// directly, same showArticle contract/logic) -- just with mlb.GameSummaryView
// (everything above) in place of NewsView's own article list.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.GameSummaryPane",
	kind : "SlidingPane",
	flex : 1,
	multiViewMinWidth : 0,
	components : [
		{
			name : "mainPane",
			width : "824px",
			components : [ { name : "main", kind : "mlb.GameSummaryView", flex : 1 } ]
		},
		{
			name : "articlePane",
			width : "450px",
			fixedWidth : true,
			peekWidth : 412,
			components : [ { name : "articleWebView", kind : "mlb.ArticleReaderView", flex : 1 } ]
		}
	],
	// External entry point -- same calling convention views/ScoreboardView.js's
	// openGamedayForGame already uses for Views["Gameday"].setGame.
	setGame : function (game) {
		this.$.mainPane.select();
		this.$.main.setGame(game);
	},
	// Same logic as views/NewsView.js's own showArticle -- see that file's
	// header comment on mlb.ArticleReaderView's external contract
	// (params/title/show()) this relies on.
	showArticle : function (article) {
		if (!article || !article.link) {
			return;
		}
		this.$.articleWebView.title = article.title;
		this.$.articleWebView.params = { "url" : article.link };
		this.$.articleWebView.show();
		this.$.articlePane.select();
	}
});
