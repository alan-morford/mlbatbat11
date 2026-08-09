// "Videos" -- ESPN highlight-clip streaming. Own top-level left-nav entry
// (data/localExtras.js's leftnav, views/Panels2.js's panes,
// views/Main.js's Views registry), same registration shape as
// views/AbsTeamsView.js's mlb.TeamsView. See com.mlb.atbat2011.service/
// MLBAudioService.js's downloadEspnVideo/getEspnVideoDownloadStatus for
// the server-side-download-then-local-HTTP-launch playback approach --
// CONFIRMED WORKING on real hardware, 2026-08-08 (see this project's own
// mlbatbat_espn_video_streaming memory).
//
// Single flat top-level kind (mlb.VideosView) -- no SlidingPane wrapper.
// An earlier version split grid/detail across two sliding panes; per
// direct user feedback ("no need to open a whole pane... popup a popup
// for the video info, like Dailymotion does") tapping a tile now opens a
// small Popup instead (title/date/length/Play only -- the grid tile
// already showed the thumbnail, no need to reload it).
//
// Data source: ESPN's SCOREBOARD API (site.api.espn.com/.../mlb/scoreboard
// ?dates=YYYYMMDD), not the general news feed an earlier version used.
// Each scoreboard event's competitions[0].highlights[0] is that GAME's own
// "Game Highlights" clip -- and, unlike the general news feed's "Media"
// items, ALREADY includes duration and links.source.HD.href (the direct
// playable MP4) right in the scoreboard response, no second clip-detail
// fetch needed at all. Switched to this per direct user feedback: the
// general news feed only ever surfaced ~13 clips even at very large
// `limit` values (it mixes in Story/Recap/Preview/HeadlineNews content,
// crowding out actual game highlights), and occasionally showed more than
// one clip for the same team that had nothing to do with a recent game.
// One event = one real completed game = at most one highlight, so this
// can't duplicate, and a single day's slate (confirmed live: 11-15 events,
// matching this project's own CLAUDE.md note on a "real ~15-game slate")
// reliably yields close to a full page on its own.
//
// "Last 15 game highlights" (per direct user request) means walking
// backward day-by-day (see ensureEnoughClips/gotScoreboard) rather than
// growing a single fetch's `limit` -- there's no equivalent of "give me
// more games" within one day, only "look at an earlier day". A thin/
// heavily team-filtered result (one team plays roughly once a day) can
// need many day-fetches to reach 15 -- MAX_DAYS_PER_SESSION caps that
// per tap so a sparse filter can't hang indefinitely.
//
// Team filtering matches ESPN's OWN abbreviation convention
// (competitor.team.abbreviation, e.g. "ARI" for Arizona -- confirmed live
// this differs from data/MLBTeamReference.js's Stats-API-sourced
// `abbreviation` field "AZ" for the same team, same ESPN-vs-Stats-API
// quirk that file's own header comment already documents for logos/news)
// -- compared against each team's own `espnSlug` (uppercased), not
// `abbreviation`.
//
// NOT scroll-position-triggered infinite loading. This app's own history
// (views/AudioView.js's own comment on its broadcasts list) already shows
// a prior attempt to get a real scrollTop/getBoundaries() API on this
// device by swapping to a plain enyo.Scroller broke that list outright
// (rendered blank on-device, root cause never confirmed without device
// console access) -- reverted back to VirtualList's own internal row-index
// tracking instead. Given that specific, confirmed-on-THIS-device failure
// mode, wiring automatic "load more when near the bottom" off a plain
// Scroller's scroll position here was judged too risky to gamble on
// blind. A tappable "Load More" row at the bottom instead -- same
// unbounded-content result, just an explicit tap instead of a passive
// scroll trigger.
//
// Team filtering UI mirrors views/NewsView.js's own team picker exactly
// (same Popup+VirtualList shape, same .teamListItem CSS, same
// "listItemClick reaches the real view via the global Views registry, not
// an owner chain" approach -- a Popup's floated content doesn't reliably
// preserve normal static-nesting ownership, per that file's own working
// precedent) -- a new parallel kind here (mlb.VideoTeamListView) rather
// than reusing mlb.MLBTeamListView directly, since that one is hardcoded
// to `Views["News"]`. ALL_MLB_TEAM (the synthetic "no filter" entry) is a
// global declared in views/NewsView.js (loaded earlier, see depends.js)
// and reused as-is here, not redeclared.

// Small shared formatting helpers -- date/duration both come straight off
// the scoreboard highlight object (originalPublishDate: ISO8601 UTC, same
// directly-parseable shape as every other MLB/ESPN timestamp already used
// in this app; duration: whole seconds).
var VideosUtil = {
	MONTHS : [ "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ],
	formatDate : function (iso) {
		if (!iso) {
			return "";
		}
		var d = new Date(iso);
		if (isNaN(d.getTime())) {
			return "";
		}
		return this.MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
	},
	formatDuration : function (seconds) {
		if (typeof seconds !== "number" || seconds < 0) {
			return "";
		}
		var m = Math.floor(seconds / 60);
		var s = Math.floor(seconds % 60);
		return m + ":" + (s < 10 ? "0" : "") + s;
	},
	formatDateParam : function (d) {
		var yyyy = d.getFullYear();
		var mm = ("0" + (d.getMonth() + 1)).slice(-2);
		var dd = ("0" + d.getDate()).slice(-2);
		return "" + yyyy + mm + dd;
	}
};

// ---------------------------------------------------------------------------
// Team filter popup -- see file header comment for why this parallels
// views/NewsView.js's mlb.MLBTeamListView rather than reusing it directly.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.VideoTeamListItem",
	kind : "enyo.HFlexBox",
	published : {
		team : null
	}
});

enyo.kind({
	name : "mlb.VideoTeamListView",
	kind : "enyo.VFlexBox",
	flex : 1,
	create : function () {
		this.teams = [];
		this.inherited(arguments);
	},
	components : [ {
		kind : "VirtualList",
		className : "teamList",
		flex : 1,
		name : "teamList",
		onSetupRow : "listSetupRow",
		components : [ {
			name : "teamListItem",
			kind : "mlb.VideoTeamListItem",
			className : "teamListItem",
			onclick : "listItemClick"
		} ]
	} ],
	rendered : function () {
		this.node = enyo.byId(this.id);
		this.inherited(arguments);
		this.teams = [ ALL_MLB_TEAM ].concat(MLBTeamReference.teams.slice().sort(function (a, b) {
			var A = a.name.toLowerCase(), B = b.name.toLowerCase();
			return A < B ? -1 : (A > B ? 1 : 0);
		}));
		this.$.teamList.refresh();
	},
	listSetupRow : function (inSender, inIndex) {
		if (inIndex >= 0 && inIndex < this.teams.length) {
			this.$.teamListItem.team = this.teams[inIndex];
			this.$.teamListItem.setContent(this.teams[inIndex].name);
			return true;
		}
		return false;
	},
	listItemClick : function (item) {
		if (Views["Videos"] && Views["Videos"].selectTeam) {
			Views["Videos"].selectTeam(item.team);
		}
		this.parent.close();
	}
});

enyo.kind({
	name : "mlb.VideosHeader",
	kind : "Toolbar",
	style : "height:40px",
	components : [ {
		kind : "Popup",
		name : "chooseTeamPopup",
		showHideMode : "auto",
		dismissWithClick : true,
		style : "width:100px; height:700px; padding:0",
		components : [ {
			flex : 1,
			style : "width:100%; height:100%",
			name : "teamList",
			kind : "mlb.VideoTeamListView"
		} ]
	}, {
		kind : "Button",
		name : "chooseTeam",
		caption : "MLB",
		onclick : "chooseTeamClicked",
		style : "width:200px;",
		className : "enyo-button-dark"
	} ],
	chooseTeamClicked : function (sender) {
		this.$.chooseTeamPopup.openAtControl(sender, { top : -10, left : -10 });
	}
});

// ---------------------------------------------------------------------------
// Grid tile.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.VideoTile",
	kind : "enyo.Control",
	className : "videoGridTile",
	published : {
		clip : null
	},
	components : [
		{ name : "thumb", kind : "Image", className : "videoGridTileThumb" },
		{ name : "headline", className : "videoGridTileHeadline" },
		{ name : "date", className : "videoGridTileDate" }
	],
	setClip : function (clip) {
		this.clip = clip;
		if (!clip) {
			return;
		}
		this.$.thumb.setSrc(clip.thumbnail);
		this.$.headline.setContent(clip.headline);
		this.$.date.setContent(VideosUtil.formatDate(clip.published));
	}
});

// ---------------------------------------------------------------------------
// Outer view -- registered as the "Videos" top-level pane (see
// views/Panels2.js's panes and views/Main.js's Views registry). Grid +
// team header + a blocking loading overlay, all in one flat kind (see file
// header comment for why this isn't a SlidingPane anymore).
//
// No info/Play popup -- per direct user feedback ("skip the popup for
// videos... just launch an overlay") tapping a tile now goes STRAIGHT into
// download+play (no intermediate info card at all), same flow as the
// sibling `dailymotion` project's Dailymotion.js playVideo(): an
// absolutely-positioned, tap-blocking overlay (playbackOverlay) appears
// immediately, showing a spinner + status text (with a download
// percentage once known) + Cancel, mirroring that project's own
// showPlaybackOverlay/hidePlaybackOverlay/cancelDownload exactly, per
// direct user request to check that implementation.
//
// playbackOverlay is a plain enyo.VFlexBox, NOT enyo.Scrim -- copied
// directly from Dailymotion.js's own comment on why: enyo.Scrim's theme
// CSS ties visibility to an "enyo-scrim-dim" class that sets CSS opacity
// on the WHOLE element (and everything inside it), separate from
// whatever background color is set, which left a Scrim-based version's
// Cancel button translucent and unreliably tappable there. flex:0
// (declared explicitly below) -- FlexLayout defaults any child WITHOUT an
// explicit flex to flex:1 even when position:absolute, per this project's
// own established enyo_flex_and_slidingpane_gotchas finding; omitting
// flex here would silently reserve real flex-row space for this overlay
// even while hidden.
//
// Unlike Dailymotion's more elaborate region-scoped blocker setup
// (headerBlocker/leftPaneBlocker, kept separate specifically because that
// app's own SlidingView siblings apply a CSS transform, which creates a
// new stacking context an absolutely-positioned overlay elsewhere can't
// paint above regardless of z-index) -- mlb.VideosView has no SlidingView
// descendants of its own (header is a plain Toolbar, scroller a plain
// enyo.Scroller, neither transformed), so ONE overlay spanning this whole
// view's own box (position:absolute; top/left/right/bottom:0, anchored by
// .videosView's own position:relative) is enough to block every tap
// underneath it, header included -- no stacking-context workaround needed
// here.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.VideosView",
	kind : "enyo.VFlexBox",
	flex : 1,
	className : "videosView",
	components : [ {
		name : "header",
		kind : "mlb.VideosHeader",
		flex : 0
	}, {
		name : "scroller",
		kind : "enyo.Scroller",
		flex : 1,
		components : [ {
			name : "status",
			className : "videoGridStatus",
			content : "Loading..."
		}, {
			// Dynamically createComponent()'d tiles below -- click handling
			// follows the same container-declares-the-handler pattern
			// established in views/ScoreboardList.js: a dynamic child's
			// owner is whatever container createComponent() was called on
			// (this "grid" control), not that container's OWN owner, so
			// the handler has to live directly on this static config and
			// delegate up via this.owner (mlb.VideosView, per normal
			// static-nesting rules).
			name : "grid",
			className : "videoGrid",
			tileClicked : function (inSender) {
				if (this.owner && this.owner.videoTileClicked) {
					this.owner.videoTileClicked(inSender);
				}
			}
		}, {
			name : "loadMoreRow",
			kind : "Button",
			caption : "Load More",
			className : "videoLoadMoreButton",
			showing : false,
			onclick : "loadMoreClicked"
		} ]
	}, {
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
			{
				kind : "Button",
				className : "videoPlaybackCancelButton",
				caption : "Cancel",
				onclick : "cancelPlayback"
			}
		]
	}, {
		name : "getScoreboard",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "httpRequest",
		onSuccess : "gotScoreboard",
		onFailure : "scoreboardFailed"
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
		// Same palm://com.palm.applicationManager "launch" call the
		// sibling `dailymotion` project's Dailymotion.js uses (and the
		// official webOS MeTube app before it).
		name : "launchVideoPlayer",
		kind : "PalmService",
		service : "palm://com.palm.applicationManager/",
		method : "launch",
		onSuccess : "videoPlayerLaunched",
		onFailure : "videoPlayerLaunchFailed"
	} ],

	// --- Pagination state -- see file header comment. ---
	PAGE_SIZE : 15,
	// Was 30 -- lowered per direct user report of a ~25s wait for a
	// single team (Cubs) that only had 2 real highlights available.
	// Root-caused via live testing (2026-08-08): ESPN's scoreboard
	// highlights simply don't exist for most of a given team's games at
	// all -- confirmed across several teams (Yankees, Red Sox, Dodgers,
	// Cubs, Diamondbacks) that walking back even 15 days rarely turns up
	// more than 1-2 clips per team; the general News feed's own "Media"
	// items for the same teams matched those exact same clips, so this
	// isn't a retention-window or search-depth gap that a deeper walk (or
	// a different ESPN endpoint) could close -- it's a genuine ceiling in
	// what ESPN publicly posts/retains per team, not a bug in how far
	// back this looks. 15 keeps a worst-case sparse-team wait roughly
	// half of what 30 produced, without giving up meaningfully earlier
	// than 30 already effectively did (nothing new was found past ~15 in
	// any team tested).
	MAX_DAYS_PER_SESSION : 15,

	team : null, // defaults to ALL_MLB_TEAM on first show()
	allClips : [], // full accumulated list found so far, newest-first
	visibleCount : 0, // how many of allClips are currently rendered as tiles
	currentDate : null, // walks backward one calendar day per fetch
	daysScanned : 0,
	loading : false,
	exhausted : false, // true once MAX_DAYS_PER_SESSION was hit without reaching the target
	pendingTarget : 0,

	// --- Popup/playback state ---
	currentClip : null,
	playingId : null, // guards the play/download/poll chain against a stale response, see isCurrentClip
	downloading : false,
	pollTimer : null,
	pollAttempts : 0,
	MAX_POLL_ATTEMPTS : 150, // ~5 min at 2s/poll -- same generous cap as the sibling dailymotion project's own DMBroker poll loop

	// Left-nav "entering this view" hook -- same convention as
	// views/AbsStatsView.js's mlb.AbsStatsView.show(). Always resets back
	// to a fresh first page, same "reselecting always resets to the entry
	// state" spec as News/AbsStats/Teams.
	show : function () {
		this.team = this.team || ALL_MLB_TEAM;
		this.$.header.$.chooseTeam.setCaption(this.team.name);
		this.resetAndLoad();
	},

	selectTeam : function (team) {
		this.team = team || ALL_MLB_TEAM;
		this.$.header.$.chooseTeam.setCaption(this.team.name);
		this.resetAndLoad();
	},

	resetAndLoad : function () {
		// Re-selecting Videos or switching teams mid-download shouldn't
		// leave a stuck overlay/orphaned poll running behind the fresh
		// grid load -- same cancel path as the overlay's own Cancel
		// button.
		if (this.downloading) {
			this.cancelPlayback();
		}
		this.allClips = [];
		this.visibleCount = 0;
		this.exhausted = false;
		this.daysScanned = 0;
		this.currentDate = new Date();
		this.$.grid.destroyComponents();
		this.$.grid.render();
		this.$.status.setContent("Loading...");
		this.$.status.setShowing(true);
		this.$.loadMoreRow.setShowing(false);
		this.$.scroller.scrollTo(0, 0);
		this.ensureEnoughClips(this.PAGE_SIZE);
	},

	loadMoreClicked : function () {
		this.ensureEnoughClips(this.visibleCount + this.PAGE_SIZE);
	},

	// Walks backward day-by-day (fetching one scoreboard per day) until at
	// least `target` clips are accumulated, then reveals up to `target`.
	// No-ops into a straight reveal if already enough are accumulated
	// (e.g. a previous call already fetched more than was needed then).
	ensureEnoughClips : function (target) {
		if (this.allClips.length >= target || this.exhausted) {
			this.revealUpTo(target);
			return;
		}
		if (this.loading) {
			return;
		}
		if (this.daysScanned >= this.MAX_DAYS_PER_SESSION) {
			this.exhausted = true;
			this.revealUpTo(target);
			return;
		}
		this.loading = true;
		this.pendingTarget = target;
		// Hidden while a fetch is in flight, not captioned "Loading..." --
		// per direct user feedback, a Load More button that keeps
		// re-appearing with that caption during the (now much faster,
		// progressively-revealed -- see gotScoreboard) background walk read
		// as distracting rather than useful. revealUpTo (called after every
		// fetch resolves) only re-shows it, captioned plain "Load More",
		// once idle.
		this.$.loadMoreRow.setShowing(false);
		var url = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=" +
			VideosUtil.formatDateParam(this.currentDate);
		this.$.getScoreboard.call({ url : url, method : "GET" });
	},

	gotScoreboard : function (inSender, inResponse) {
		this.loading = false;
		this.daysScanned++;
		var events = (inResponse && inResponse.json && inResponse.json.events) || [];
		for (var i = 0; i < events.length; i++) {
			var comp = events[i].competitions && events[i].competitions[0];
			var hi = comp && comp.highlights && comp.highlights[0];
			if (!hi) {
				continue; // this game has no highlight posted (yet, or ever)
			}
			if (this.team && this.team.espnSlug && !this.eventMatchesTeam(comp, this.team.espnSlug)) {
				continue;
			}
			var source = hi.links && hi.links.source;
			// mp4Url/hlsUrl kept only as the "has this clip got a real
			// playable source at all" existence check below -- neither is
			// actually downloaded from anymore. Playback now goes through
			// metube.webosarchive.org instead (clipUrl below, an ESPN clip
			// PAGE url, handed to yt-dlp server-side via
			// MLBAudioService.js's downloadEspnVideoViaMetube) -- see that
			// function's own header comment for why (this device's naive
			// local HLS-segment concatenation, the ORIGINAL fix for the
			// H.264-Level-5.1 problem mp4Url alone had, turned out to be its
			// own separate, unresolved structural bug).
			var mp4Url = source && ((source.HD && source.HD.href) || source.href);
			var hlsUrl = source && source.HLS && source.HLS.href;
			if (!mp4Url || !hlsUrl || !hi.id) {
				continue;
			}
			this.allClips.push({
				id : hi.id,
				headline : hi.headline || "",
				description : hi.description || hi.headline || "",
				thumbnail : hi.thumbnail || "",
				published : hi.originalPublishDate || hi.lastModified || "",
				duration : hi.duration,
				mp4Url : mp4Url,
				hlsUrl : hlsUrl,
				clipUrl : "https://www.espn.com/video/clip/_/id/" + hi.id
			});
		}
		// Small accumulated list (well under 100 typically) -- a plain
		// re-sort after every fetch is cheap and keeps the guarantee
		// simple, rather than relying on day-walk order alone (correct at
		// the day level, but not guaranteed within a single day's events).
		this.allClips.sort(function (a, b) {
			return new Date(b.published).getTime() - new Date(a.published).getTime();
		});

		// Walk backward one calendar day for the NEXT attempt regardless
		// of whether this one found anything -- a date with zero games
		// (an off day) or zero highlights yet (today, mid-slate) is normal
		// and shouldn't stop the walk.
		this.currentDate.setDate(this.currentDate.getDate() - 1);

		// Reveal whatever's been found SO FAR after every single day's
		// fetch, not just once the full `target` is reached or the walk is
		// exhausted -- per direct user report, waiting for the full 15-day
		// walk (up to ~30s, one sequential network round-trip per day) before
		// showing anything for a team with sparse ESPN highlight coverage was
		// too slow. This doesn't change how many days get walked, only WHEN
		// tiles for what's already been found appear -- a team with a clip on
		// day 1 now sees it immediately instead of waiting for day 15 to
		// finish (or exhaust) first, while the walk keeps going toward
		// `target` in the background exactly as before.
		this.revealUpTo(this.allClips.length);

		var target = this.pendingTarget;
		if (this.allClips.length >= target) {
			return; // already revealed above
		}
		if (this.daysScanned >= this.MAX_DAYS_PER_SESSION) {
			this.exhausted = true;
			this.revealUpTo(this.allClips.length);
			return;
		}
		this.ensureEnoughClips(target);
	},
	scoreboardFailed : function () {
		this.loading = false;
		this.daysScanned++;
		this.currentDate.setDate(this.currentDate.getDate() - 1);
		if (this.allClips.length === 0 && this.daysScanned >= this.MAX_DAYS_PER_SESSION) {
			this.exhausted = true;
			this.$.status.setContent("Couldn't load videos right now.");
			this.$.status.setShowing(true);
			this.$.loadMoreRow.setShowing(false);
			return;
		}
		// A single failed day-fetch isn't fatal -- keep walking back
		// toward the same target, same "one bad response doesn't end the
		// session" spirit as this view's other retry paths.
		this.ensureEnoughClips(this.pendingTarget);
	},

	// True if either competitor in this game matches the given team's
	// ESPN abbreviation (espnSlug, uppercased -- see file header comment
	// for why NOT data/MLBTeamReference.js's own `abbreviation` field).
	eventMatchesTeam : function (comp, espnSlug) {
		var competitors = comp.competitors || [];
		for (var j = 0; j < competitors.length; j++) {
			var abbr = (competitors[j].team && competitors[j].team.abbreviation) || "";
			if (abbr.toLowerCase() === espnSlug.toLowerCase()) {
				return true;
			}
		}
		return false;
	},

	revealUpTo : function (target) {
		if (this.allClips.length === 0) {
			// Progressive reveal (see gotScoreboard) calls this after EVERY
			// day's fetch, including early ones that haven't found anything
			// yet -- only show the "nothing found" message once the walk is
			// actually exhausted, not on every empty intermediate day (that
			// would otherwise flash this message on/off before flipping back
			// to real tiles a moment later for a team whose most recent
			// highlight is a few days back).
			this.$.status.setContent(this.exhausted ?
				"No highlight clips found for this team right now." : "Loading...");
			this.$.status.setShowing(true);
			this.$.loadMoreRow.setShowing(false);
			return;
		}
		this.$.status.setShowing(false);
		var cap = Math.min(target, this.allClips.length);
		if (cap > this.visibleCount) {
			this.appendTiles(this.allClips.slice(this.visibleCount, cap));
			this.visibleCount = cap;
		}
		// Hidden entirely once exhausted (per direct user request -- an
		// earlier version left it visible with a "No more videos available"
		// caption instead) OR while a fetch is still in flight (see
		// ensureEnoughClips -- this same function runs again once that
		// fetch resolves and will re-show it then if still appropriate).
		var noMoreLeft = this.exhausted && this.visibleCount >= this.allClips.length;
		this.$.loadMoreRow.setShowing(!this.loading && !noMoreLeft);
	},

	appendTiles : function (clipsToAdd) {
		for (var i = 0; i < clipsToAdd.length; i++) {
			var tile = this.$.grid.createComponent({
				kind : "mlb.VideoTile",
				onclick : "tileClicked"
			});
			tile.setClip(clipsToAdd[i]);
		}
		this.$.grid.render();
	},

	// --- Playback (no info popup -- see file header comment) ---

	_cancelled : false, // same flag/purpose as the sibling dailymotion project's own Dailymotion.js -- guards a response that lands after Cancel was tapped from acting anyway (including a late "ready" launching the player out from under a user who already backed out)

	videoTileClicked : function (inSender) {
		if (inSender.clip) {
			this.playClip(inSender.clip);
		}
	},

	isCurrentClip : function (id) {
		return !!this.currentClip && this.currentClip.id === id;
	},

	// Download-then-relay, NOT direct streaming (a direct-stream attempt,
	// mirroring webos-metube's own default strategy for non-Pre/Pre2
	// devices, was tried and confirmed live NOT to work on this
	// hardware). Routed through metube.webosarchive.org as of 2026-08-09
	// (clipUrl, an ESPN clip PAGE url -- NOT clip.hlsUrl anymore) -- see
	// MLBAudioService.js's downloadEspnVideoViaMetube for why (this
	// device's own local HLS-segment concatenation, the fix for the
	// original H.264-Level-5.1 problem, turned out to have its own
	// separate, unresolved structural bug). downloadVideo -> poll
	// checkStatus -> on "ready", launch with target=playUrl (now
	// metube.webosarchive.org's own play.php URL, plain http:// -- same
	// "no TLS needed by the media pipeline" reasoning the sibling
	// `dailymotion` project's own DMBroker-lib.js already documents for
	// this exact service).
	playClip : function (clip) {
		if (!clip.clipUrl || this.downloading) {
			return;
		}
		this.currentClip = clip;
		this._cancelled = false;
		this.downloading = true;
		this.playingId = clip.id;
		this.pollAttempts = 0;
		this.showPlaybackOverlay("Preparing video...");
		this.$.downloadVideo.call({
			clipUrl : clip.clipUrl,
			jobId : clip.id
		});
	},

	showPlaybackOverlay : function (statusText) {
		this.$.playbackStatus.setContent(statusText);
		this.$.playbackOverlay.show();
		// This view's own overlay only ever covers ITS own box (header +
		// grid) -- confirmed live (2026-08-08) it does NOT block the
		// left-nav menu, which lives entirely outside mlb.VideosView
		// (see views/Panels2.js/Main.js's setLeftNavBlocked). Per direct
		// user feedback: the overlay should stop the user from touching
		// anything else at all while a video is loading, not just this
		// view's own content.
		main.setLeftNavBlocked(true);
	},
	hidePlaybackOverlay : function () {
		this.$.playbackOverlay.hide();
		main.setLeftNavBlocked(false);
	},

	// playbackOverlay's Cancel button -- also effectively fires if the
	// user backs out of this view entirely while a download is in flight
	// (show()/selectTeam() resetting state doesn't stop an in-flight poll
	// by itself, so this is also called from resetAndLoad below to be
	// safe). No server-side cancel exists (same reality as the sibling
	// dailymotion project's own DMBroker -- add/status only) -- this only
	// stops the DEVICE from reacting further; the server-side download may
	// keep running to completion unobserved.
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
			return; // a stale poll response -- stopPolling() from cancelPlayback/a new playClip already stopped the interval, this is just a straggler
		}
		if (!inResponse || !inResponse.returnValue) {
			return; // a single missed poll isn't fatal, MAX_POLL_ATTEMPTS gives up eventually
		}
		if (inResponse.status === "ready") {
			this.stopPolling();
			this.showPlaybackOverlay("Launching player...");
			this.$.launchVideoPlayer.call({
				id : "com.palm.app.videoplayer",
				params : {
					target : inResponse.playUrl,
					videoTitle : this.currentClip.headline
				}
			});
		} else if (inResponse.status === "failed") {
			this.stopPolling();
			this.downloading = false;
			this.showPlaybackOverlay("Download failed: " + (inResponse.error || "unknown error"));
		} else {
			// "downloading" -- percentage from MLBAudioService.js's
			// downloadEspnVideoHls (segment-count based: segmentsDone /
			// segmentTotal), NOT the earlier single-file download's
			// Content-Length-HEAD-request approach that turned out to
			// cause a real playback regression -- this one is pure local
			// bookkeeping (segments already being downloaded either way),
			// no extra network request added.
			var pct = (typeof inResponse.progress === "number" && inResponse.progress > 0) ?
				(" " + inResponse.progress + "%") : "";
			this.showPlaybackOverlay("Now Loading..." + pct);
		}
	},
	statusCheckFailed : function () {
		// Same reasoning as gotStatus's early-return above -- let the poll
		// loop's own attempt cap be what eventually gives up.
	},

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

	// Swallows taps landing on the overlay itself (its own background,
	// not the Cancel button) -- same purpose as the sibling dailymotion
	// project's own _swallowClick, stops a tap from reaching whatever's
	// underneath (the grid/header) while blocked.
	_swallowClick : function () {
		return true;
	}
});
