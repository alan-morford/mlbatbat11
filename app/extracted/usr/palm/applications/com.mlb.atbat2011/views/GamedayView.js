// Gameday, rebuilt against MLB Stats API's live game feed. The original
// embedded a remote MLB-hosted pitch-tracker webpage
// (wapc.mlb.com/gd3/apps/native/palm.jsp, dead -- DNS doesn't resolve) via a
// WebView whose URL hash MLB's own page read to switch between Gameday/Box/
// Summary/Video/Field/Wrap/Preview/Probables sub-views -- there was no local
// data-parsing logic to port, and none of those sub-views have a live
// replacement (box scores, in particular, are out of scope here too, same
// as cbssports left them out of scope). Scoped down to linescore +
// scrolling play-by-play text per the project plan; the tab bar and the
// Video sub-view are dropped for now (Video's own backend is still dead,
// pending its own restoration phase) rather than carried over broken.
// views/ScoreboardView.js already passes game.gamePk (a real Stats API id)
// as `gid` into setGame(), which is exactly what this needs.
//
// This is a full pane (views/Panels2.js's panes, name "Gameday"), not a
// popup like the original -- a 420px popup left team names truncated and
// columns cramped with no real fix available; opening into the same
// full-size content area Scoreboard/Standings/News use gives it real room.
// Since it's not reachable from the left nav, it needs its own explicit way
// back (mlb.GamedayHeader's back button), unlike GenericWebView's FAQ/About
// panes which rely on re-tapping a left-nav item.
enyo.kind( {
	name : "mlb.GamedayHeader",
	kind : "Header",
	// Wrapped in an enyo.HFlexBox rather than left as bare direct children
	// of Header -- the audio button's tap wasn't reaching its onclick
	// handler at all (confirmed: not even a diagnostic alert() fired), and
	// the ONE other place in this app with a confirmed-working clickable
	// Header button (views/ScoreboardView.js's mlb.ScoreboardHeader) never
	// places a CustomButton directly on Header either -- every one of its
	// direct children is itself an HFlexBox/RadioToolButtonGroup. backButton
	// + matchup were bare direct children before this and back navigation
	// was never explicitly confirmed working either, so this may have been
	// broken for both, not just the new button.
	components : [
		{
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
				// Left of the team names (matchup label below) -- opens a
				// popup of this game's radio feeds, owned by
				// mlb.GamedayView (see openAudioPopup). Reuses the same
				// audio.png icon as views/ScoreboardView.js's
				// mlb.ScoreboardHeader audio button rather than a new asset.
				{
					kind : "CustomButton",
					name : "audioButton",
					className : "gamedayAudioButton",
					onclick : "audioButtonClicked",
					components : [ {
						kind : "Image",
						src : "imgs/icons/audio.png"
					} ]
				},
				{ name : "matchup", className : "gamedayMatchup" }
			]
		}
	],
	backClicked : function() {
		this.owner.backToScoreboard();
	},
	audioButtonClicked : function() {
		this.owner.openAudioPopup();
	},
	setMatchup : function(text) {
		this.$.matchup.setContent(text);
	}
});

// GamedayLive's layout tree below is nested purely for positioning
// (topBar/mainColumns/leftColumn/rightColumn/matchupRow/pitchZoneRow are
// all plain inline HFlexBox/VFlexBox wrappers, not their own enyo.kind) --
// Enyo's this.$ namespace is flat across the whole owner regardless of
// nesting depth, so every leaf component below (linescore, diamond,
// pitchZone, playByPlay) is still reached the exact same way it always
// was; only the genuinely new leaf components (batterCard, dueUp,
// silhouettes, pitchZoneCol/plate, pitcherCard) are new this.$ entries.
// playsScroller/playByPlay are relocated as an intact subtree with zero
// internal changes -- this app has a hard-won lesson that swapping out a
// working VirtualList's own scroller mechanism can silently break
// rendering with no on-device console to diagnose why; relocating a
// working VirtualList's PARENT container (same flex model, deeper
// nesting) is a materially smaller, different risk, but still worth
// checking first on the initial build of this change.
enyo.kind( {
	name : "mlb.GamedayLive",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [
		{
			name : "topBar",
			kind : "enyo.HFlexBox",
			className : "gamedayTopBar",
			flex : 0,
			align : "center",
			showing : false,
			components : [
				// ABS challenges-remaining renders as its own column ("ABS
				// Left") inside mlb.GamedayLinescore's own table, in line
				// with the away/home run rows -- see that kind's
				// setLinescore -- not a separate widget here.
				{ name : "linescore", kind : "mlb.GamedayLinescore", flex : 1 },
				// Back to top-right of topBar (not centered across the
				// whole pane) -- outs sits to the bases' left this time,
				// not below them.
				{ name : "outs", kind : "mlb.GamedayOuts", flex : 0 },
				{ name : "diamond", kind : "mlb.GamedayDiamond", flex : 0 }
			]
		},
		{ name : "noGame", className : "gamedayNoGame", content : "Select a game to see live details." },
		{
			name : "mainColumns",
			kind : "enyo.HFlexBox",
			className : "gamedayMainColumns",
			flex : 1,
			showing : false,
			components : [
				{
					name : "leftColumn",
					kind : "enyo.VFlexBox",
					className : "gamedayLeftColumn",
					flex : 1,
					components : [
						{
							name : "matchupRow",
							kind : "enyo.HFlexBox",
							className : "gamedayMatchupRow",
							flex : 0,
							align : "center",
							components : [
								// NOTE: these two component NAMES describe
								// POSITION (left slot / right slot), not
								// which player's data they hold -- per
								// direct user feedback, the two players'
								// entire card contents (label/statType/
								// data) are swapped between positions
								// below in setGame, while each position
								// keeps its OWN original visual arrangement
								// (left: image-then-text, normal flow;
								// right: text-then-image, right-edge
								// anchored) -- so "batterCard" (the LEFT,
								// image-first slot) actually displays
								// PITCHER info, and "pitcherCard" (the
								// RIGHT, text-first slot) displays BATTER
								// info. An earlier attempt instead swapped
								// image/text order WITHIN each player's own
								// card while keeping player-to-position
								// binding fixed -- corrected per feedback:
								// that wasn't what was wanted, the players
								// themselves should swap slots entirely.
								{ name : "batterCard", kind : "mlb.GamedayPlayerCard", label : "Now Pitching", statType : "pitching" },
								// pitcherCard is position:absolute (see
								// .gamedayPlayerCardReversed), anchored to
								// matchupRow's own right edge -- NOT flex
								// packing/spacer-based. Confirmed live that
								// neither pack:"justify" nor a flex:1 spacer
								// actually landed it flush against the edge
								// (both left it much closer to center); a
								// plain CSS right:0 doesn't depend on
								// whatever was making flex distribution
								// misbehave here.
								{ name : "pitcherCard", kind : "mlb.GamedayPlayerCard", label : "Now Batting", statType : "batting", reverse : true, imageFirst : false }
							]
						},
						{
							name : "pitchZoneRow",
							kind : "enyo.HFlexBox",
							className : "gamedayPitchZoneRow",
							flex : 1,
							pack : "center",
							// align:"end" (not "center") -- diamond.jpg's home
							// plate/batter boxes sit near the BOTTOM of the
							// photo, not its middle, so this cluster needs to
							// hug the bottom of the available space to land
							// near them instead of floating mid-column.
							align : "end",
							components : [
								{ name : "leftSilhouette", className : "gamedaySilhouette gamedaySilhouetteLeft" },
								{
									name : "pitchZoneCol",
									kind : "enyo.VFlexBox",
									className : "gamedayPitchZoneCol",
									flex : 0,
									align : "center",
									components : [
										{ name : "pitchZone", kind : "mlb.GamedayPitchZone", flex : 0 },
										{ name : "plate", className : "gamedayPlate" }
									]
								},
								{ name : "rightSilhouette", className : "gamedaySilhouette gamedaySilhouetteRight" }
							]
						},
						// Pitch-color key -- position:absolute (see
						// .gamedayPitchLegend), bottom-left of leftColumn.
						// Reuses the same pitchBall/pitchStrike/pitchFoul/
						// pitchInPlay classes mlb.GamedayPitchZone's own
						// dots use (via getPitchResultClass), so a color
						// changing there never needs a matching change
						// here. 4 pitch outcomes are tracked, not 3 --
						// foul is its own color (orange), distinct from
						// ball/strike/in-play.
						{
							name : "pitchLegend",
							className : "gamedayPitchLegend",
							components : [
								{ className : "gamedayPitchLegendRow", components : [
									{ className : "gamedayPitchLegendDot pitchBall" },
									{ content : "Ball", className : "gamedayPitchLegendLabel" }
								]},
								{ className : "gamedayPitchLegendRow", components : [
									{ className : "gamedayPitchLegendDot pitchStrike" },
									{ content : "Strike", className : "gamedayPitchLegendLabel" }
								]},
								{ className : "gamedayPitchLegendRow", components : [
									{ className : "gamedayPitchLegendDot pitchFoul" },
									{ content : "Foul", className : "gamedayPitchLegendLabel" }
								]},
								{ className : "gamedayPitchLegendRow", components : [
									{ className : "gamedayPitchLegendDot pitchInPlay" },
									{ content : "In Play", className : "gamedayPitchLegendLabel" }
								]}
							]
						}
					]
				},
				{
					name : "rightColumn",
					kind : "enyo.VFlexBox",
					className : "gamedayRightColumn",
					flex : 0,
					components : [
						{
							name : "onDeck",
							kind : "enyo.HFlexBox",
							className : "gamedayOnDeck",
							align : "center",
							showing : false,
							components : [
								{ name : "onDeckHeadshot", kind : "Image", className : "gamedayOnDeckHeadshot" },
								{ name : "onDeckText", className : "gamedayOnDeckText" }
							]
						},
						{ kind : "Scroller", flex : 1, name : "playsScroller", components : [
							{ name : "playByPlay", kind : "mlb.GamedayPlayByPlay", flex : 1 }
						] }
					]
				}
			]
		}
	],
	setGame : function(parsedGame) {
		this.$.noGame.hide();
		this.$.topBar.show();
		this.$.mainColumns.show();
		this.$.linescore.setLinescore(parsedGame.linescore, parsedGame.awayTeamName, parsedGame.homeTeamName, parsedGame.absChallenges);
		if (parsedGame.linescore) {
			this.$.diamond.setRunners(parsedGame.linescore.onFirst, parsedGame.linescore.onSecond, parsedGame.linescore.onThird);
			this.$.outs.setOuts(parsedGame.linescore.outs);
		}
		this.$.pitchZone.setPitches(parsedGame.currentAtBat);
		this.$.playByPlay.setPlays(parsedGame.plays);

		var matchup = parsedGame.matchup || {};
		// $.batterCard/$.pitcherCard are POSITION names (left/right slot),
		// not player-role names -- see their own config comment above.
		// batterCard is the left, image-first slot, now labeled "Now
		// Pitching", so it gets the PITCHER's data, and vice versa.
		this.$.batterCard.setPlayer(matchup.pitcher);
		this.$.pitcherCard.setPlayer(matchup.batter);
		this.setOnDeck(matchup.onDeck);
		this.updateSilhouette(matchup.batter && matchup.batter.handedness);
	},
	// On-deck batter's headshot + "On deck: <name>", shown atop the
	// play-by-play column. matchup.onDeck is {id, name} or null (nobody on
	// deck -- e.g. the final at-bat of a completed game).
	setOnDeck : function(onDeck) {
		if (!onDeck) {
			this.$.onDeck.hide();
			return;
		}
		this.$.onDeck.show();
		// Same headshot CDN pattern as mlb.GamedayPlayerCard.getHeadshotUrl --
		// not worth a shared helper for one extra caller and a single URL
		// template string.
		this.$.onDeckHeadshot.setSrc(
			"https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/"
			+ onDeck.id + "/headshot/67/current"
		);
		this.$.onDeckText.setContent("On deck: " + onDeck.name);
	},
	// Only the silhouette matching the current batter's actual handedness
	// shows; visibility:hidden (not setShowing/display:none) so the empty
	// slot keeps its layout space, which is what keeps the pitch zone
	// visually centered between two fixed-width flanking columns
	// regardless of which side (or neither, for an unexpected handedness
	// value) is active.
	//
	// Note the LEFT-positioned slot lights up for a RIGHT-handed batter
	// and vice versa (matches css/GamedayView.css's .gamedaySilhouetteLeft/
	// Right, which point at righthanded.png/lefthanded.png respectively,
	// not the other way round) -- confirmed live this was backwards
	// before: a batter's silhouette showing on the correct side of the
	// screen needs the OPPOSITE handedness's image, same broadcast
	// convention as a real strike-zone graphic viewed from the pitcher's
	// mound (a right-handed batter's box is on the screen-left side from
	// that view).
	updateSilhouette : function(handedness) {
		this.$.leftSilhouette.addRemoveClass("gamedaySilhouetteHidden", handedness !== "R");
		this.$.rightSilhouette.addRemoveClass("gamedaySilhouetteHidden", handedness !== "L");
	},
	clear : function() {
		this.$.topBar.hide();
		this.$.mainColumns.hide();
		this.$.noGame.show();
	},
	// One-hop forward to mlb.GamedayView (this kind's own owner) -- see
	// mlb.GamedayPlayByPlay.playItemClick, which is the actual originator.
	challengeTapped : function(play) {
		if (this.owner && this.owner.showChallengeDetail) {
			this.owner.showChallengeDetail(play);
		}
	}
});

enyo.kind( {
	name : "mlb.GamedayView",
	kind : "enyo.VFlexBox",
	flex : 1,
	published : {
		game : null,
		state : "",
		gameDate : null
	},
	components : [
		{ name : "header", kind : "mlb.GamedayHeader", flex : 0 },
		{ name : "live", kind : "mlb.GamedayLive", flex : 1 },
		// GrabButton (enyo.GrabButton, slidingHandler:true) is a drag
		// handle that lets the user manually drag/expand this pane --
		// removed per explicit request to disable that. If this turns out
		// not to have been the actual "expand to full screen" mechanism,
		// removing an inert bottom toolbar with a single drag-only button
		// in it costs nothing either way.
		{
			name : "getGame",
			kind : "GamedayStatsAPIService",
			onSuccess : "gotGame",
			onFailure : "gameFailed"
		},
		// Radio-feed picker -- NOT a separate Gameday-specific popup.
		// Reuses the exact same Views.Audio singleton (mlb.AudioView) and
		// popup chrome shape views/ScoreboardView.js's own headphone icon
		// opens (showGameDayAudio), just pointed at whichever game Gameday
		// is already showing (see openAudioPopup) instead of requiring the
		// user to pick one from a list -- same login gate, same feed-button
		// look, same everything, so it's indistinguishable from the main
		// screen's version except for skipping straight to this game's
		// feeds. Scoreboard's own popup/behavior is untouched; the shared
		// hooks this relies on (views/AudioView.js's hostView/
		// closeOnFeedSelect/autoSelectGamePk) all default to preserving its
		// original behavior exactly.
		{
			kind : "Scrim",
			flex : 1,
			name : "scrim",
			onclick : "closeAudioPopup",
			showing : false,
			style : "position:absolute;height:768px;top:50px;width:1024px;background-color:#333;"
		},
		{
			kind : "Popup",
			name : "audioPopup",
			dismissWithClick : false,
			className : "audioPopup",
			style : "height:620px;width:430px; border:none; -webkit-border-image:none;",
			components : [ {
				name : "audioChrome",
				flex : 1,
				style : "height:618px;width:428px; background-color:transparent !important;border:none;"
			} ]
		},
		// Tapped challenged-play detail -- mlb.GamedayChallengeDetail (below),
		// a self-contained ModalDialog styled to match views/Main.js's own
		// update-check popup (see that kind's own header comment for why:
		// per direct user feedback, an earlier Popup+Scrim version here still
		// looked like the old full-pane view stuffed into a smaller box, not
		// a clean popup). Also used by views/GameSummaryView.js's own
		// mlb.GameSummaryPlayByPlay.
		{ name : "challengeDetail", kind : "mlb.GamedayChallengeDetail" }
	],

	// Tightened from the app-wide 15s convention (ScoreboardView/AudioView's
	// own polling) specifically for Gameday -- confirmed live (2026-07-26)
	// that MLB's feed/live data itself is close to real-time (a live
	// at-bat's most recent pitch was only ~11s old when checked), so a 15s
	// poll was our own bottleneck, not the data source: with a modern
	// pitch clock, a full plate appearance can complete in well under 15s,
	// which read as the play-by-play list being "way ahead of" the pitch
	// graphic (both come from the same response, but a whole at-bat could
	// pass between polls with no visible in-between state). 8s trades some
	// of that gap for roughly 2x the fetch/parse frequency against an
	// ~800KB response -- reasonable on this device's WiFi, but real CPU
	// cost for this app's own WebKit JS engine parsing that JSON every 8s
	// over a 3+ hour game; revisit if that turns out to matter more than
	// the lag did.
	pollInterval : 8000,
	pollTimer : null,

	backToScoreboard : function() {
		this.clearGameView();
		main.showViewInMiddle("Scoreboard", Views.Scoreboard);
	},

	clearGameView : function() {
		this.stopPolling();
		this.game = null;
		this.$.live.clear();
	},

	setGame : function(gamePk, state) {
		this.stopPolling();
		this.game = gamePk;
		this.state = state;
		this.fetchGame();
	},

	fetchGame : function() {
		if (!this.game) {
			return;
		}
		this.$.getGame.urlParams = {
			"gamePk" : this.game
		};
		this.$.getGame.call();
	},

	startPolling : function() {
		var self = this;
		this.pollTimer = setTimeout(function() {
			self.fetchGame();
		}, this.pollInterval);
	},

	stopPolling : function() {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	},

	gotGame : function(inSender, inResponse) {
		try {
			var parsed = GamedayParser.parseGameFeed(inResponse);
			this.$.live.setGame(parsed);
			this.$.header.setMatchup(parsed.awayTeamName + " @ " + parsed.homeTeamName);
			// Broadcasts are fetched by DATE (schedule?hydrate=broadcasts),
			// not by gamePk -- stash it here so openAudioPopup has it
			// without a second feed/live parse.
			this.gameDate = parsed.officialDate;

			// Final games don't change further -- stop polling a completed
			// game left sitting open. Preview/Live both keep polling
			// (Preview: waiting for first pitch; Live: in progress).
			if (parsed.abstractGameState !== "Final") {
				this.startPolling();
			}
		}
		catch (e) {
			console.log("gotGame parse error: " + e);
			this.startPolling();
		}
	},

	gameFailed : function() {
		console.log("Gameday fetch failed for gamePk " + this.game);
		this.startPolling();
	},

	// Header's audio icon -- see mlb.GamedayHeader.audioButtonClicked.
	// Points the SAME Views.Audio singleton views/ScoreboardView.js's own
	// audio icon uses at this game specifically, then renders it into
	// THIS pane's own chrome div (mlb.AudioView gets re-parented via
	// renderInto every time it's opened, regardless of which host asked --
	// that's how it already worked for Scoreboard before this).
	openAudioPopup : function() {
		this.$.scrim.show();
		this.$.audioPopup.openAtCenter();
		// Compact size up front, right after the FIRST openAtCenter, not
		// before it -- confirmed live this crashed ("Cannot call method
		// 'applyStyle' of undefined" on audioChrome) when placed earlier:
		// same lazy-child-construction behavior as Calendar's DatePicker
		// (see mlb.AbsScoreboardHeader's own calendarButtonClick comment,
		// views/AbsStatsView.js) -- this Popup kind doesn't actually
		// construct its declared children (audioChrome included) until
		// it's been opened at least once, so resizeAudioPopup's
		// this.$.audioChrome reference was undefined. audioPopup's own
		// declared style is a fixed 620px tall (sized for the full
		// Scoreboard-hosted game list, views/ScoreboardView.js's own
		// showGameDayAudio), and this popup can also be left at whatever
		// size a PRIOR open (compact or full) last resized it to, from
		// either host. Without this, the popup could visibly open at 620px
		// and only shrink once Views.Audio's own render/login-gate logic
		// gets around to resizing it -- normally fast enough not to
		// notice, but genuinely slow (and visible) when a silent token
		// refresh is needed (see mlb.AudioView.refreshLoginGate). Sizing
		// to the compact default here means there's nothing to visibly
		// jump from in the common case, and refreshLoginGate's own resize
		// calls (compact/login/full) still take over correctly from here
		// for whichever state actually applies.
		this.resizeAudioPopup(Views.Audio.COMPACT_HEIGHT);

		var gameDateObj = this.gameDate ? new Date(this.gameDate + "T12:00:00") : new Date();
		if (!Views.Audio.date || Views.Audio.date.toDateString() != gameDateObj.toDateString()) {
			Views.Audio.date = gameDateObj;
			// Force a fresh fetch for this date even if a prior popup
			// session already fetched a different date -- see
			// mlb.AudioView.showLoggedInUI, which only auto-fetches once
			// per popup lifetime otherwise.
			Views.Audio.scoreboardFetched = false;
		}
		Views.Audio.hostView = this;
		Views.Audio.closeOnFeedSelect = true;
		Views.Audio.autoSelectGamePk = this.game;
		// Just the status/play-pause box + this game's feed buttons --
		// Gameday already knows exactly which one game it wants, no need
		// to show the full browse-every-game list Scoreboard's own popup
		// does.
		Views.Audio.compactMode = true;

		Views.Audio.renderInto(enyo.byId(this.$.audioChrome.id));
	},

	closeAudioPopup : function() {
		this.$.audioPopup.close();
		this.$.scrim.hide();
		// Reset so a later open of the SAME singleton from
		// views/ScoreboardView.js's own audio icon never inherits
		// Gameday-only state -- Scoreboard's showGameDayAudio doesn't set
		// any of these itself, so without this reset they'd otherwise
		// leak forward from whatever Gameday last did.
		Views.Audio.hostView = null;
		Views.Audio.closeOnFeedSelect = false;
		Views.Audio.autoSelectGamePk = null;
		Views.Audio.compactMode = false;
	},

	// Called by views/AudioView.js's resizePopup when it's hosted here
	// (this.hostView === this) -- mirrors
	// views/ScoreboardView.js's own resizeAudioPopup, minus that one's
	// scroller-relative position math (this popup just re-centers itself
	// after each height change instead, e.g. the login-form-height ->
	// full-height jump once a silent/manual login completes).
	resizeAudioPopup : function(height) {
		this.$.audioPopup.applyStyle("height", height + "px");
		this.$.audioChrome.applyStyle("height", (height - 2) + "px");
		this.$.audioPopup.openAtCenter();
	},

	// Opens the challenge-detail popup -- see mlb.GamedayChallengeDetail
	// below, a self-contained ModalDialog. this.game is already tracked
	// (setGame) so there's nothing else this needs to pass along besides
	// the tapped play itself.
	showChallengeDetail : function(play) {
		this.$.challengeDetail.loadChallenge(this.game, play);
	},

});

// ---------------------------------------------------------------------------
// Tapped challenged-play detail. A self-contained ModalDialog (own fetch/
// watchdog/render), used by BOTH mlb.GamedayView above (live games) and
// views/GameSummaryView.js's mlb.GameSummaryPlayByPlay (completed games) --
// each just calls loadChallenge(gamePk, play) on its own instance.
//
// Styled to match views/Main.js's own update-check popup (ModalDialog,
// bold centered title, bordered content Scroller, centered footer button)
// rather than trying to shrink the old full-pane view into a smaller box --
// per direct user feedback, an earlier Popup+Scrim version here still LOOKED
// like the old pane (a custom Header bar with an inline close button) even
// though it opened as a popup, and looked inconsistent with the app's one
// other confirmed-clean popup. ModalDialog handles its own scrim/modality
// internally (see enyo.BasicPopup's scrim:true/modal:true) -- no separate
// Scrim component needed, unlike the plain "Popup" kind audioPopup (above)
// uses.
//
// The inner enyo.VFlexBox is given an EXPLICIT pixel height/width, not
// flex:1 -- ModalDialog (like plain Popup) is not itself a flex container,
// so a flex:1 child directly inside one has nothing to flex against and
// collapses to near-zero height. Confirmed by reading the actual framework
// source (enyo.Popup/BasicPopup) after an earlier version of this exact
// popup shipped with flex:1 here and rendered as "just a grey bar" (only
// the natural-height title text visible, the Scroller collapsed to 0) --
// the same technique views/Main.js's own updatePopup and this file's own
// audioPopup (audioChrome, given explicit pixel sizing rather than flex:1)
// already use for the same reason.
//
// Reuses AbsChallengeFormat.buildChallengeRowHtml (lib/parsers/
// AbsChallengeFormat.js) for identical rendering to mlb.AbsGameStats' own
// per-game challenge list (views/AbsStatsView.js), fetching the SAME
// full-game Baseball Savant challenge list via getAbsChallengeEvents
// (MLBAudioService.js) and then picking out just the one challenge whose
// ab_number matches this play's atBatIndex+1 -- see lib/parsers/
// GamedayParser.js's parsePlays for why that's the right mapping (confirmed
// live against real data).
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.GamedayChallengeDetail",
	kind : "ModalDialog",
	dismissWithClick : false,
	style : "height:340px; width:540px;",
	components : [ {
		kind : "enyo.VFlexBox",
		// align:"center" (set here) turned out to be a red herring for the
		// left/right symmetry problem -- it only governs how THIS
		// container's own CHILDREN (title/red box/button row, all declared
		// at the SAME width as the container) are centered WITHIN it, and
		// with zero width difference between container and children there
		// was never any slack for it to act on. The real asymmetry (screenshot,
		// 2026-08-19: left gap ~18px, right gap ~50px at width:460px) is
		// this CONTAINER's own position within the ModalDialog's plain
		// "client" content div, which -- confirmed via that same
		// screenshot -- is NOT a flex container either (same class of
		// finding as this file's "Popup is not a flex container" one),
		// so this VFlexBox just sits flush at the content div's natural
		// left edge regardless of its own declared width, with no real
		// centering happening at that level at all. Rather than fight that
		// (no way to inspect/confirm the true available content width
		// without an on-device console), WIDENING while leaving the fixed
		// left edge alone closes the gap difference directly: 460px ->
		// 490px (460 + (measured right 50px - measured left 18px) = 492,
		// rounded down slightly for safety margin against the
		// measurement's own imprecision).
		// margin-left:5px shifts this whole container (and everything in
		// it -- title, red box, button row all move together) 5px right,
		// per direct user request, without changing its own width.
		style : "height:300px; width:495px; margin-left:5px;",
		align : "center",
		components : [
			{
				flex : 0,
				content : "Challenge Details",
				style : "width:495px; font-weight:bold; font-size:130%; margin-bottom:10px; text-align:center; -webkit-box-sizing:border-box; box-sizing:border-box;"
			},
			// Plain centering VFlexBox, NOT a Scroller -- content here is
			// always one short challenge row (a ~120px-tall diagram plus a
			// few lines of text), never a scrolling list (that's
			// mlb.AbsGameStats' own separate, now-unreachable view), so
			// there's nothing that actually needs to scroll. No pack/align
			// centering any more -- per direct user request, the content's
			// own bounding box (the HtmlContent below, and .challengeRow's
			// own CSS in css/AbsStatsView.css) is now given width:100%/
			// height:100% so it exactly fills this box instead of
			// shrink-wrapping its natural (smaller) size and floating
			// centered inside extra empty space. .challengeImageCell/
			// .challengeTextCell switched to vertical-align:middle (was
			// top) so the actual diagram+text still look vertically
			// centered within that now-full-height row, rather than stuck
			// to its top edge.
			{
				kind : "enyo.VFlexBox",
				// margin-left:-3px shifts ONLY this box left, per direct
				// user request -- independent of the title/button row,
				// which stay where the container's own margin-left:5px
				// (above) puts them. White background + rounded corners
				// (border-radius, matching the ModalDialog's own rounded
				// chrome) per direct user request, in place of the earlier
				// TEMPORARY diagnostic thick red border (now reverted to a
				// normal thin border) used to confirm layout changes were
				// actually reaching the device.
				style : "width:495px; height:190px; border:1px solid #ccc; border-radius:10px; -webkit-border-radius:10px; background-color:#fff; margin-bottom:10px; margin-left:-3px; -webkit-box-sizing:border-box; box-sizing:border-box;",
				components : [ { name : "content", kind : "enyo.HtmlContent", className : "fullArticleView", style : "width:100%; height:100%; -webkit-box-sizing:border-box; box-sizing:border-box;" } ]
			},
			// Explicit height taller than the Button's own natural size,
			// plus align:"center" (HFlexBox's cross-axis, i.e. vertical,
			// alignment) -- per direct user request, moves Close off the
			// bottom edge into the middle of the space it already had
			// instead of hugging the bottom of it.
			{
				flex : 0,
				kind : "enyo.HFlexBox",
				pack : "center",
				align : "center",
				style : "width:495px; height:56px; -webkit-box-sizing:border-box; box-sizing:border-box;",
				components : [ {
					kind : "Button",
					caption : "Close",
					style : "width:150px;",
					onclick : "closeClicked"
				} ]
			}
		]
	}, {
		name : "getChallenges",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "getAbsChallengeEvents",
		onSuccess : "gotChallenges",
		onFailure : "challengesFailed"
	} ],

	targetAtBatIndex : null,
	watchdogTimer : null,

	closeClicked : function() {
		this.close();
	},

	// isRetry: internal -- see views/AbsStatsView.js's mlb.AbsGameStats.
	// loadGame for the full on-device-confirmed reasoning (this device's
	// PalmServiceBridge occasionally drops a request with no trace at all,
	// not even a normal onFailure) -- same fix here: one silent automatic
	// retry before actually giving up.
	//
	// openAtCenter() FIRST, setContent AFTER -- ModalDialog (like plain
	// Popup) doesn't actually construct its declared children until it's
	// been opened at least once (same lazy-child-construction gotcha this
	// file's own openAudioPopup documents, and the exact bug
	// mlbatbat_update_check_popup's own ModalDialog hit first).
	loadChallenge : function(gamePk, play, isRetry) {
		this.targetAtBatIndex = play && play.atBatIndex;
		this.openAtCenter();
		if (!isRetry) {
			this.$.content.setContent('<div class="articleTitle">Loading...</div>');
		}
		if (this.watchdogTimer) {
			clearTimeout(this.watchdogTimer);
		}
		var self = this;
		this.watchdogTimer = setTimeout(function() {
			if (!isRetry) {
				SportsLogger.log("GamedayChallengeDetail", "watchdog: retrying once for gamePk=" + gamePk);
				self.watchdogTimer = null;
				self.loadChallenge(gamePk, play, true);
				return;
			}
			self.watchdogTimer = null;
			self.$.content.setContent(
				'<div class="articleTitle">Challenge Detail</div>' +
				'<div class="articleBody">Couldn\'t load challenge detail.</div>'
			);
		}, 15000);
		this.$.getChallenges.call({ gamePk : gamePk });
	},

	gotChallenges : function(inSender, inResponse) {
		if (this.watchdogTimer) {
			clearTimeout(this.watchdogTimer);
			this.watchdogTimer = null;
		}
		var challenges = (inResponse && inResponse.returnValue && inResponse.challenges) || [];
		var targetAbNumber = (typeof this.targetAtBatIndex === "number") ? this.targetAtBatIndex + 1 : null;
		var match = null;
		for (var i = 0; i < challenges.length; i++) {
			if (challenges[i].ab_number === targetAbNumber) {
				match = challenges[i];
				break;
			}
		}
		if (!match) {
			this.$.content.setContent(
				'<div class="articleTitle">Challenge Detail</div>' +
				'<div class="articleBody">Detail not available yet -- try again in a moment.</div>'
			);
			return;
		}
		this.$.content.setContent(AbsChallengeFormat.buildChallengeRowHtml(match));
	},

	challengesFailed : function() {
		if (this.watchdogTimer) {
			clearTimeout(this.watchdogTimer);
			this.watchdogTimer = null;
		}
		this.$.content.setContent(
			'<div class="articleTitle">Challenge Detail</div>' +
			'<div class="articleBody">Couldn\'t load challenge detail.</div>'
		);
	}
});
