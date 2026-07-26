// Standings, rebuilt against MLB Stats API. The original view was just a
// WebView pointed at http://wap.mlb.com/atbat/palm/standings/, which is
// dead (DNS doesn't resolve) -- there was never any local data-parsing logic
// to repoint, so this is a native rewrite. See lib/parsers/StandingsParser.js
// for the response mapping and views/StandingsList.js/StandingsTeamRow.js
// for the rendering.
enyo
		.kind( {
			name : "mlb.StandingsView",
			kind : "enyo.VFlexBox",

			published : {
				mode : "divisional",
				divisions : null
			},
			components : [
			{
				kind: "enyo.ApplicationEvents",
				name: "appEvents",
				onWindowActivated:"windowActivated"
			},
			{
				name : "standingsViewHeader",
				kind : "mlb.StandingsViewHeader",
				flex : 0
			}, {
				kind : "Scroller",
				flex : 1,
				components : [ {
					kind : "mlb.StandingsList",
					name : "standingsList",
					flex : 1
				} ]
			},

			{
				kind : "Toolbar",
				height : "40px",
				flex : 0,
				components : [ {
					kind : "GrabButton"
				} ]
			},

			{
				name : "getStandings",
				kind : "StandingsStatsAPIService",
				onSuccess : "standingsReturn",
				onFailure : "standingsFailed"
			}

			],

			show : function() {
				var _self = this;

				this.$.standingsViewHeader.buttonClicked = function(name) {
					_self.mode = (name == "wildcardButton") ? "wildcard" : "divisional";
					_self.updateStandingsList();
				};

				if (!this.divisions) {
					this.fetchStandings();
				}
			},
			fetchStandings : function() {
				main.showMiddleSpinner();

				this.$.getStandings.urlParams = {
					"season" : new Date().getFullYear()
				};
				this.$.getStandings.call();
			},
			standingsReturn : function(inSender, inResponse) {
				main.hideMiddleSpinner();
				try {
					this.divisions = StandingsParser.parseStandingsFromStatsAPI(inResponse);
				}
				catch (e) {
					console.log("standingsReturn parse error: " + e);
					this.divisions = [];
				}
				this.updateStandingsList();
			},
			standingsFailed : function() {
				main.hideMiddleSpinner();
				this.divisions = [];
				this.updateStandingsList();
			},
			updateStandingsList : function() {
				if (!this.divisions) {
					return;
				}
				if (this.mode == "wildcard") {
					this.$.standingsList.setGroups(
						StandingsParser.groupByLeagueForWildCard(this.divisions),
						"wildCardGamesBack"
					);
				} else {
					this.$.standingsList.setGroups(this.divisions, "gamesBack");
				}
			},
			windowActivated: function() {
				this.fetchStandings();
			}

		});

enyo
		.kind( {
			name : "mlb.StandingsViewHeader",
			kind : "Header",
			published : {
				buttonClicked : function(name) {
				}
			},
			components : [
					{
						kind : enyo.HFlexBox,
						flex : 1,
						name : "spacer"
					},
					{
						kind : "RadioToolButtonGroup",
						flex : 1,
						components : [
								{
									name : "divisionalButton",
									caption : "Divisional",
									className : "enyo-radiobutton-dark enyo-grouped-toolbutton-dark enyo-first",
									onclick : "clicked"

								},
								{
									name : "wildcardButton",
									caption : "Wild Card",
									className : "enyo-radiobutton-dark enyo-grouped-toolbutton-dark enyo-last",
									onclick : "clicked"
								}

						]
					}, {
						kind : enyo.HFlexBox,
						flex : 1,
						name : "spacer"
					} ],

			clicked : function(sender) {
				this.buttonClicked(sender.name);
			}
		});
