// News, rebuilt against ESPN's undocumented site-API news endpoint (see
// lib/WebServices.js's NewsJSONService, lib/parsers/NewsParser.js) in place
// of the dead wapc.mlb.com/m.mlb.com two-stage XML flow. That endpoint has
// no full article body, no byline/subhead/related-media -- so
// mlb.FullArticleView/mlb.FullArticleViewHeader and the SlidingPane detail-
// pane machinery that drove them are dropped entirely; tapping an article
// now opens its own link in-app via the existing mlb.GenericWebView instead.
// The MLB/Team RadioToolButtonGroup in the original mlb.NewsViewHeader had
// showing:false (permanently hidden, its second Pane view was unreachable
// dead code) -- the only live navigation path was always the "choose team"
// popup button, which is what's kept here. The team picker is now driven by
// data/MLBTeamReference.js (fresh) instead of data/clubProps.js (stale
// 2011 data), and team filtering is exact (server-side team= param),
// unlike an earlier RSS-based attempt that needed fuzzy client-side matching.
//
// Confirmed live via on-device SportsLogger (2026-08-07): ESPN's Akamai edge
// 403s this app's own WebKit XHR requesting this endpoint every single time
// ("Access Denied", AkamaiGHost), even though the identical request succeeds
// from a dev machine -- same shape as the Okta ROPC block this app already
// works around (see lib/AudioFlow.js's login()/httpRequestCmd), so
// mlb.MLBNewsView.getArticles routes this fetch through
// com.mlb.atbat2011.service's curl-backed httpRequest command instead of
// this WebService's own call(), which is kept only for URL building now.
var NewsDebug = {
	safeStringify : function(obj) {
		try {
			return JSON.stringify(obj).substring(0, 500);
		} catch (e) {
			return "" + obj;
		}
	}
};

enyo
		.kind( {
			name : "mlb.ArticleListItem",
			kind : enyo.VFlexBox,
			className : "articleListItem",
			published : {
				article : null
			},
			components : [
				{ className : "articleListItemTitle", name : "articleTitle", nodeTag : "div" },
				{ name : "articleBlurb", className : "articleListItemBlurb", nodeTag : "div" }
			]
		});

enyo
		.kind( {
			name : "mlb.NewsViewHeader",
			kind : "Toolbar",
			style : "height:40px",
			components : [
					{
						kind : "Popup",
						name : "chooseTeamPopup",
						showHideMode : "auto",
						dismissWithClick : true,
						style : "width:100px; height:700px; padding:0",
						components : [ {
							flex : 1,
							style : "width:100%; height:100%",
							name : "teamList",
							kind : "mlb.MLBTeamListView"
						} ]
					},
					{
						kind : "Button",
						name : "chooseTeam",
						caption : "MLB",
						onclick : "chooseTeamClicked",
						style : "width:200px;",
						className: "enyo-button-dark"

					},
					// Persists whichever category (MLB or a specific team)
					// is currently showing as the one News opens to from now
					// on -- see mlb.NewsView.setDefaultTeam/getDefaultTeam.
					{
						kind : "Button",
						name : "setDefault",
						caption : "Set as Default",
						onclick : "setDefaultClicked",
						style : "width:150px;",
						className: "enyo-button-dark"
					} ],

			chooseTeamClicked : function(sender) {
				this.$.chooseTeamPopup.openAtControl(sender, {
					top : -10,
					left : -10
				});
			},

			setDefaultClicked : function() {
				// Show the confirmation FIRST, then actually persist/hide
				// on a short delay -- owner.setDefaultTeam() hides this
				// button immediately (see updateSetDefaultButtonVisibility),
				// so persisting before showing any feedback would mean the
				// button vanishes before "Default Set!" was ever visible.
				var button = this.$.setDefault;
				var owner = this.owner;
				button.setCaption("Default Set!");
				setTimeout(function() {
					owner.setDefaultTeam();
					// Reset the caption for next time this button reappears
					// (a different team gets selected later).
					button.setCaption("Set as Default");
				}, 800);
			}

		});

enyo.kind( {
	name : "mlb.TeamListItem",
	kind : "enyo.HFlexBox",
	published : {
		team : null
	}
});

// The "All MLB" entry is synthetic (not a real team, no espnSlug) --
// mlb.MLBNewsView.applyFilter()/getArticles() treat a falsy espnSlug as
// "no team filter" (see views/NewsView.js below).
var ALL_MLB_TEAM = { id: 0, name: "MLB", espnSlug: "", location: "", nickname: "MLB" };

// Persisted via lib/LocalStorageCache.js's TheCache (same never-expire,
// -1-TTL convention lib/OktaAuth.js's cached refresh token uses) -- just
// the numeric team id (0 for ALL_MLB_TEAM, otherwise one of
// data/MLBTeamReference.js's real ids), not the whole team object, so a
// future change to that reference data doesn't leave a stale serialized
// object sitting in localStorage.
var NEWS_DEFAULT_TEAM_CACHE_KEY = "newsDefaultTeam";

enyo.kind( {
	name : "mlb.MLBTeamListView",
	kind : "enyo.VFlexBox",
	flex : 1,
	create : function() {
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
			kind : "mlb.TeamListItem",
			className : "teamListItem",
			onclick : "listItemClick"

		} ]
	} ],

	rendered : function() {
		this.node = enyo.byId(this.id);
		this.inherited(arguments);

		this.teams = [ ALL_MLB_TEAM ].concat(MLBTeamReference.teams.slice().sort(function(a, b) {
			var A = a.name.toLowerCase(), B = b.name.toLowerCase();
			if (A < B) {
				return -1;
			} else if (A > B) {
				return 1;
			} else {
				return 0;
			}
		}));

		this.$.teamList.refresh();
	},

	listSetupRow : function(inSender, inIndex) {

		if (inIndex >= 0 && inIndex < this.teams.length) {
			this.$.teamListItem.team = this.teams[inIndex];
			this.$.teamListItem.setContent(this.teams[inIndex].name);
			return true;
		}
		return false;
	},
	listItemClick : function(item) {
		Views["News"].showArticleList(item.team);
		this.parent.close();
	}
});

enyo.kind( {
	name : "mlb.MLBNewsView",

	className : "newsView",
	kind : enyo.VFlexBox,
	flex : 1,
	style : "background-color:#E7E7DB",
	create : function() {
		this.articles = [];
		this.currentTeam = null;
		this.inherited(arguments);
	},

	components : [ {
		kind : "VirtualList",
		className : "newsList",
		flex : 1,
		name : "newsList",
		onSetupRow : "listSetupRow",
		components : [ {
			kind : "mlb.ArticleListItem",
			onclick : "articleListItemClick"
		} ]
	}, {
		// Never .call()ed directly -- kept only so its urlTemplate (see
		// lib/WebServices.js) stays the single source of truth for the URL,
		// built via its own getUrl(). The actual fetch goes through
		// getNewsHttp below instead of this WebService's own XHR-backed
		// call(): confirmed live via on-device SportsLogger that ESPN's
		// Akamai edge (AkamaiGHost) 403s this app's real WebKit request
		// every single time ("Access Denied"), identical in shape to the
		// Okta ROPC block this app already routes around (see
		// lib/AudioFlow.js's login()/httpRequestCmd) -- some
		// fingerprint/header of the in-app WebKit XHR gets flagged as a bot
		// regardless of what this code sends, so the fix is the same:
		// route the request through com.mlb.atbat2011.service's curl-backed
		// httpRequest command instead of this app's own networking stack.
		name : "getNews",
		kind : "NewsJSONService"
	}, {
		name : "getNewsHttp",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "httpRequest",
		onSuccess : "gotNews",
		onFailure : "newsFailed"
	} ],
	listSetupRow : function(inSender, inIndex) {

		if (inIndex >= 0 && inIndex < this.articles.length) {
			var article = this.articles[inIndex];
			this.$.articleListItem.$.articleTitle.setContent(article.title);
			this.$.articleListItem.$.articleBlurb.setContent(article.description);
			this.$.articleListItem.article = article;
			return true;
		}
		return false;
	},

	articleListItemClick : function(item) {
		if (!item.article) {
			return;
		}
		// this.owner is mlb.NewsView itself (static nesting -- see mlb.NewsView's
		// own components: articleList sits inside articleListPane, but Enyo 1
		// still resolves owner to the outermost enclosing kind, matching how
		// mlb.NewsViewHeader.setDefaultClicked already delegates to
		// this.owner.setDefaultTeam() above).
		if (this.owner && this.owner.showArticle) {
			this.owner.showArticle(item.article);
		}
	},

	// Server-side filtered now (ESPN's team= param), so each team switch
	// genuinely needs its own request -- no client-side caching to reuse
	// across teams like the old RSS-based flow did.
	getArticles : function(team) {
		this.currentTeam = team;
		// `main` (index.html's `var main = new mlb.Main();`) isn't assigned
		// until that whole constructor call returns -- confirmed live
		// (device error log, 2026-08-07) that this method can run BEFORE
		// that, throwing "Cannot call method 'showMiddleSpinner' of
		// undefined" and taking the entire app's boot down with it (a
		// white-screen-at-launch symptom). Root trigger looks like
		// windowActivated -> refresh() -> here, which can fire from
		// webOS's own native window-activate event -- a genuine race
		// against this app's own synchronous `new mlb.Main()` construction
		// still finishing, not something this code can fully prevent from
		// the app side. Guarding every `main.*` call in this trio instead
		// of chasing the race itself -- worst case with `main` still
		// unready, the spinner show/hide just no-ops for that one call.
		if (typeof main !== "undefined" && main) {
			main.showMiddleSpinner();
		}
		this.$.getNews.urlParams = {
			"team" : (team && team.espnSlug) ? team.espnSlug : "",
			"limit" : 10
		};
		var url = this.$.getNews.getUrl();
		SportsLogger.log("News", "requesting (via httpRequest) " + url);
		this.$.getNewsHttp.call({ url : url, method : "GET" });
	},
	refresh : function() {
		this.getArticles(this.currentTeam);
	},
	// inResponse here is com.mlb.atbat2011.service's httpRequest result
	// shape: { returnValue, status, json, raw }, not a raw XHR/WebService
	// response -- see MLBAudioService.js's httpRequest for the contract.
	gotNews : function(inSender, inResponse) {
		if (typeof main !== "undefined" && main) {
			main.hideMiddleSpinner();
		}
		var status = inResponse && inResponse.status;
		var isSuccess = status === 0 || (status >= 200 && status < 300);
		if (!isSuccess || !inResponse.json) {
			SportsLogger.log("News", "gotNews: non-success, status=" + status +
				", raw=" + NewsDebug.safeStringify(inResponse && inResponse.raw));
			this.articles = [];
			this.$.newsList.refresh();
			return;
		}
		try {
			this.articles = NewsParser.parseNewsFromJSON(inResponse.json);
			SportsLogger.log("News", "gotNews: " + this.articles.length + " articles, status=" + status);
		}
		catch (e) {
			console.log("gotNews parse error: " + e);
			SportsLogger.log("News", "gotNews parse error: " + e);
			this.articles = [];
		}
		this.$.newsList.refresh();
	},
	newsFailed : function(inSender, inResponse) {
		if (typeof main !== "undefined" && main) {
			main.hideMiddleSpinner();
		}
		SportsLogger.log("News", "newsFailed: " + NewsDebug.safeStringify(inResponse));
		this.articles = [];
		this.$.newsList.refresh();
	}
});

enyo.kind( {
	name : "mlb.NewsView",
	className : "newsView",
	// Built on webOS's own SlidingPane/SlidingView (see devkit SDK
	// framework/source/palm/containers/SlidingPane.js + SlidingView.js) rather
	// than hand-rolled position:absolute + drag math -- an earlier attempt at
	// that got the overlap geometry wrong twice (a leftover gap, then article
	// text overflowing past pane 2's own edge) because SlidingPane already
	// solves exactly this "one view slides over another, peekWidth reveals
	// how much stays visible underneath" problem, proven elsewhere in this
	// app (Panels2.js's own leftSlidingView/rightPane). Trade-off: selecting
	// a view snaps/animates to its resting position rather than a free
	// continuous drag to an arbitrary width.
	kind : "SlidingPane",
	flex : 1,
	// This app is a fixed 1024x768-landscape TouchPad layout, never the
	// narrow/stacked mode SlidingPane falls back to below multiViewMinWidth.
	multiViewMinWidth : 0,

	components : [ {
		// Pane 2 (article list) -- SlidingPane's defaultKind is SlidingView,
		// so this (and articlePane below) become SlidingViews without an
		// explicit kind, same as this app's own top-level leftSlidingView.
		name : "articleListPane",
		width : "824px",
		components : [ {
			kind: "enyo.ApplicationEvents",
			name: "appEvents",
			onWindowActivated:"windowActivated"
		}, {
			name : "newsViewHeader",
			kind : "mlb.NewsViewHeader",
			flex : 0
		}, {
			name : "articleList",
			kind : "mlb.MLBNewsView",
			flex : 1
		}, {
			kind : "Toolbar",
			height : "40px",
			flex : 0,
			components : [ {
				kind : "GrabButton"
			} ]
		} ]
	}, {
		// Pane 3 (article view). It's the last view in the pane, which
		// SlidingPane auto-flexes to fill remaining space UNLESS fixedWidth
		// is set -- we want our own explicit width, so fixedWidth:true.
		// peekWidth is how much of pane 2 (the view "underneath") stays
		// visible on the left once this pane is selected/slid over it --
		// this is the actual overlap mechanism, handled by the framework.
		//
		// mlb.ArticleReaderView (views/ArticleReaderView.js), not the
		// Atlas-backed mlb.GenericWebView -- the live Atlas WPE embed was
		// too slow to be useful in practice; this fetches the article HTML
		// via the curl-backed httpRequest service and runs it through
		// Mozilla Readability instead, falling back to the same
		// Atlas-patched WebView only if that extraction fails. Same
		// external contract (params/title/show()) as mlb.GenericWebView,
		// so this is otherwise a drop-in swap -- see showArticle below.
		name : "articlePane",
		width : "450px",
		fixedWidth : true,
		peekWidth : 412,
		components : [ {
			name : "articleWebView",
			kind : "mlb.ArticleReaderView",
			flex : 1
		} ]
	} ],

	// Only apply the saved default on the FIRST show of a session -- show()
	// re-runs every time the user re-taps the News left-nav tab, and
	// re-applying the saved default every time would stomp whatever team
	// they'd already switched to in-session.
	initialized : false,

	show : function() {
		// Per spec: re-selecting the News tab always resets pane 3 back to
		// closed, even if an article was open last time -- only tapping an
		// article (showArticle below) selects/opens it again.
		this.$.articleListPane.select();

		if (!this.initialized) {
			this.initialized = true;
			var defaultTeam = this.getDefaultTeam();
			if (defaultTeam) {
				this.showArticleList(defaultTeam);
				return;
			}
		}
		this.$.articleList.getArticles(this.$.articleList.currentTeam);
		this.updateSetDefaultButtonVisibility(this.$.articleList.currentTeam);
	},

	showArticle : function(article) {
		if (!article || !article.link) {
			return;
		}
		this.$.articleWebView.title = article.title;
		this.$.articleWebView.params = { "url" : article.link };
		this.$.articleWebView.show();
		this.$.articlePane.select();
	},

	windowActivated: function() {
		this.$.articleList.refresh();
	},

	showArticleList : function(team) {
		this.$.newsViewHeader.$.chooseTeam.setCaption(team.name);
		this.$.articleList.getArticles(team);
		this.updateSetDefaultButtonVisibility(team);
	},

	// mlb.NewsViewHeader's "Set as Default" button. currentTeam is null
	// until the user has explicitly opened the team picker at least once
	// this session (see mlb.MLBNewsView.create) -- falls back to
	// ALL_MLB_TEAM in that case, matching how a null/falsy currentTeam
	// already means "no team filter" everywhere else in this file.
	setDefaultTeam : function() {
		var team = this.$.articleList.currentTeam || ALL_MLB_TEAM;
		TheCache.put(NEWS_DEFAULT_TEAM_CACHE_KEY, team.id, -1);
		this.updateSetDefaultButtonVisibility(team);
	},

	// Hides the button entirely while looking at whatever category is
	// already saved as the default -- nothing to offer the user there.
	// Reappears as soon as they switch to a different team (or MLB
	// overall, if a specific team is the current default).
	updateSetDefaultButtonVisibility : function(team) {
		var teamId = (team || ALL_MLB_TEAM).id;
		var defaultTeam = this.getDefaultTeam();
		var isAlreadyDefault = !!defaultTeam && defaultTeam.id === teamId;
		this.$.newsViewHeader.$.setDefault.setShowing(!isAlreadyDefault);
	},

	// Returns the saved default team object (ALL_MLB_TEAM for id 0, or a
	// lookup into data/MLBTeamReference.js otherwise), or null if nothing's
	// been saved yet or the saved id no longer matches a real team.
	getDefaultTeam : function() {
		var saved = TheCache.get(NEWS_DEFAULT_TEAM_CACHE_KEY);
		if (!saved || !saved.value) {
			return null;
		}
		var teamId = parseInt(saved.value, 10);
		if (teamId === ALL_MLB_TEAM.id) {
			return ALL_MLB_TEAM;
		}
		for (var i = 0; i < MLBTeamReference.teams.length; i++) {
			if (MLBTeamReference.teams[i].id === teamId) {
				return MLBTeamReference.teams[i];
			}
		}
		return null;
	}

});
