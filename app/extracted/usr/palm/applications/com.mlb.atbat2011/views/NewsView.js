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
		name : "getNews",
		kind : "NewsJSONService",
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
		Views["GenericWebView"].title = item.article.title;
		Views["GenericWebView"].params = { "url" : item.article.link };
		main.showViewInMiddle("GenericWebView", Views["GenericWebView"]);
	},

	// Server-side filtered now (ESPN's team= param), so each team switch
	// genuinely needs its own request -- no client-side caching to reuse
	// across teams like the old RSS-based flow did.
	getArticles : function(team) {
		this.currentTeam = team;
		main.showMiddleSpinner();
		this.$.getNews.urlParams = {
			"team" : (team && team.espnSlug) ? team.espnSlug : "",
			"limit" : 10
		};
		this.$.getNews.call();
	},
	refresh : function() {
		this.getArticles(this.currentTeam);
	},
	gotNews : function(inSender, inResponse, inRequest) {
		main.hideMiddleSpinner();
		try {
			this.articles = NewsParser.parseNewsFromJSON(inResponse);
		}
		catch (e) {
			console.log("gotNews parse error: " + e);
			this.articles = [];
		}
		this.$.newsList.refresh();
	},
	newsFailed : function() {
		main.hideMiddleSpinner();
		this.articles = [];
		this.$.newsList.refresh();
	}
});

enyo.kind( {
	name : "mlb.NewsView",
	className : "newsView",
	kind : enyo.VFlexBox,
	flex : 1,

	style : "background-color:#E7E7DB",
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
	} ],

	// Only apply the saved default on the FIRST show of a session -- show()
	// re-runs every time the user re-taps the News left-nav tab, and
	// re-applying the saved default every time would stomp whatever team
	// they'd already switched to in-session.
	initialized : false,

	show : function() {
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
