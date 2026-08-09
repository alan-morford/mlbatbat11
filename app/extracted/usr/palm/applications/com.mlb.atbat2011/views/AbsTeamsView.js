// "Teams" -- its own top-level left-nav entry (data/localExtras.js's
// leftnav, views/Panels2.js's panes, views/Main.js's Views registry),
// siblings with Scoreboard/Standings/News/ABS Stats, NOT a sub-section of
// ABS Stats -- an earlier version of this file nested it inside
// mlb.AbsStatsView instead, corrected per direct user feedback ("Instead
// of a teams button within ABS Stats I meant add Teams as a new entry in
// the left side menu"). mlb.TeamsView (bottom of this file) is the
// registered top-level kind, a thin SlidingPane wrapper exactly like
// views/GamedayView.js's mlb.GamedayPane, around a three-deep drill-down:
//   mlb.AbsTeamGrid   -- 4-wide logo grid, all 30 teams, no fetch needed
//   mlb.AbsTeamRoster -- tapped team's active roster + season stats/player,
//                        split into Position Players / Pitchers sections
//   mlb.AbsPlayerStats -- tapped player's year-by-year stat table
//
// Click handling on every dynamically-created tile/row below follows the
// same pattern already proven in views/ScoreboardList.js: the STATIC
// container declares the handler function directly in its own component
// config (giving it the correct owner via normal static-nesting rules),
// and each dynamically createComponent()'d child's onclick names that
// handler -- Enyo 1.0 resolves a dynamic child's owner to whatever
// container createComponent() was called ON, not that container's own
// owner, so the handler can't live any higher up than the container itself.

// ---------------------------------------------------------------------------
// Pane: 4-wide team logo grid.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.AbsTeamTile",
	kind : "enyo.Control",
	className : "absTeamTile",
	published : {
		team : null
	},
	components : [
		{ name : "logo", kind : "Image", className : "absTeamTileLogo" },
		{ name : "name", className : "absTeamTileName" }
	],
	setTeam : function (team) {
		this.team = team;
		if (!team) {
			return;
		}
		this.$.name.setContent(team.location ? (team.location + " " + team.nickname) : team.name);
		this.setLogo(team.espnSlug);
	},
	// Same ESPN-CDN cache mechanism as views/ScoreboardGameBox.js's
	// setLogo/cachedTeamLogoDataUri/fetchAndCacheTeamLogo -- those are
	// plain global functions (not kind methods), reused as-is here so a
	// logo already cached from the main Scoreboard grid is free on this
	// screen too, and vice versa. team.espnSlug (data/MLBTeamReference.js)
	// already carries the one CDN-confirmed slug per team, no need to
	// re-derive or special-case anything here.
	setLogo : function (slug) {
		var cached = cachedTeamLogoDataUri(slug);
		if (cached) {
			this.$.logo.setSrc(cached);
			return;
		}
		var url = "https://a.espncdn.com/i/teamlogos/mlb/500/" + slug + ".png";
		this.$.logo.setSrc(url);
		var imgControl = this.$.logo;
		fetchAndCacheTeamLogo(slug, url, function (dataUri) {
			if (imgControl.hasNode && imgControl.hasNode()) {
				imgControl.setSrc(dataUri);
			}
		});
	}
});

enyo.kind({
	name : "mlb.AbsTeamGrid",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [ {
		name : "scroller",
		kind : "enyo.Scroller",
		flex : 1,
		components : [ {
			name : "grid",
			className : "absTeamGrid",
			tileClicked : function (inSender) {
				if (this.owner && this.owner.teamTileClicked) {
					this.owner.teamTileClicked(inSender);
				}
			}
		} ]
	}, {
		kind : "Toolbar",
		height : "40px",
		flex : 0,
		components : [ { kind : "GrabButton" } ]
	} ],
	// Team data is static (data/MLBTeamReference.js) -- unlike every other
	// pane in this app, there's no fetch/refresh to do here at all, so the
	// grid only ever needs to be built once.
	create : function () {
		this.inherited(arguments);
		var teams = MLBTeamReference.teams;
		for (var i = 0; i < teams.length; i++) {
			var tile = this.$.grid.createComponent({
				kind : "mlb.AbsTeamTile",
				onclick : "tileClicked"
			});
			tile.setTeam(teams[i]);
		}
		this.$.grid.render();
	},
	// Generic "a team tile was tapped" hook -- NOT hardcoded to
	// showTeamRoster, so this whole grid kind is reusable by any owner
	// (see views/ScheduleView.js's mlb.ScheduleView, which reuses this
	// exact kind for its own team-picker pane and implements its own
	// teamTileTapped to open a calendar instead of a roster).
	teamTileClicked : function (inSender) {
		var team = inSender.team;
		if (team && this.owner && this.owner.teamTileTapped) {
			this.owner.teamTileTapped(team);
		}
	}
});

// ---------------------------------------------------------------------------
// Pane: tapped team's roster + season stats, split into two sections.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.AbsPlayerRow",
	kind : "enyo.HFlexBox",
	className : "absPlayerRow",
	align : "center",
	published : {
		player : null
	},
	components : [
		{ name : "headshot", kind : "Image", className : "absPlayerRowHeadshot" },
		{ kind : "enyo.VFlexBox", flex : 1, components : [
			{ name : "name", className : "absPlayerRowName" },
			{ name : "statLine", className : "absPlayerRowStatLine" }
		] }
	],
	setPlayer : function (player) {
		this.player = player;
		if (!player) {
			return;
		}
		this.$.headshot.setSrc(this.getHeadshotUrl(player.id));
		this.$.name.setContent((player.number ? ("#" + player.number + " ") : "") + player.name);
		this.$.statLine.setContent(this.formatStatLine(player));
	},
	// Same MLB headshot CDN URL confirmed working in
	// views/GamedayPlayerCard.js's getHeadshotUrl -- duplicated rather than
	// shared (that kind isn't a natural base class for this row, no other
	// overlap), matching this codebase's existing convention of small local
	// helpers over cross-file coupling for a one-line URL builder.
	getHeadshotUrl : function (id) {
		return "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/"
			+ id + "/headshot/67/current";
	},
	formatStatLine : function (player) {
		var s = player.stats || {};
		if (player.isPitcher) {
			return "ERA " + s.era + " | " + s.wins + "-" + s.losses + " | " + s.strikeOuts + " K";
		}
		return "AVG " + s.avg + " | " + s.homeRuns + " HR | " + s.rbi + " RBI";
	}
});

enyo.kind({
	name : "mlb.AbsTeamRoster",
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
		components : [ {
			name : "playersContainer",
			kind : "enyo.HFlexBox",
			className : "absRosterPlayers",
			components : [
				{
					name : "positionColumn",
					kind : "enyo.VFlexBox",
					flex : 1,
					className : "absRosterColumn",
					// Own inline handler, NOT a shared one on playersContainer --
					// per this file's own header comment, a dynamic child's
					// owner is whatever container createComponent() was called
					// ON (positionColumn/pitcherColumn themselves now, not
					// playersContainer), so each column needs its own handler
					// declared directly in its own config.
					rowClicked : function (inSender) {
						if (this.owner && this.owner.playerRowClicked) {
							this.owner.playerRowClicked(inSender);
						}
					}
				},
				{
					name : "pitcherColumn",
					kind : "enyo.VFlexBox",
					flex : 1,
					className : "absRosterColumn absRosterColumnRight",
					rowClicked : function (inSender) {
						if (this.owner && this.owner.playerRowClicked) {
							this.owner.playerRowClicked(inSender);
						}
					}
				}
			]
		} ]
	}, {
		kind : "Toolbar",
		height : "40px",
		flex : 0,
		components : [ { kind : "GrabButton" } ]
	}, {
		name : "getRoster",
		kind : "AbsTeamRosterStatsAPIService",
		onSuccess : "gotRoster",
		onFailure : "rosterFailed"
	} ],

	currentTeam : null,

	loadTeam : function (team) {
		this.currentTeam = team;
		this.$.header.$.title.setContent(team.location ? (team.location + " " + team.nickname) : team.name);
		this.$.positionColumn.destroyComponents();
		this.$.pitcherColumn.destroyComponents();
		this.$.positionColumn.render();
		this.$.pitcherColumn.render();
		// Scroller otherwise keeps whatever position the PREVIOUS team's
		// roster was left at -- per direct user feedback, selecting a new
		// team should always start at the top of its player list. Same
		// "reset scroll before kicking off the fetch" convention already
		// used elsewhere in this app, e.g. views/ScoreboardView.js's own
		// changeScoreboardDate.
		this.$.scroller.scrollTo(0, 0);
		main.showMiddleSpinner();
		this.$.getRoster.urlParams = {
			teamId : team.id,
			season : (new Date()).getFullYear()
		};
		this.$.getRoster.call();
	},

	gotRoster : function (inSender, inResponse) {
		main.hideMiddleSpinner();
		try {
			var parsed = AbsTeamsParser.parseRoster(inResponse);
			this.renderRoster(parsed);
		} catch (e) {
			console.log("AbsTeamRoster gotRoster parse error: " + e);
		}
	},
	rosterFailed : function (inSender, inResponse) {
		main.hideMiddleSpinner();
		console.log("AbsTeamRoster rosterFailed: " + JSON.stringify(inResponse).substring(0, 300));
	},

	// Two columns -- position players (left) / pitchers (right) -- per
	// direct user request, instead of one stacked list.
	renderRoster : function (parsed) {
		this.$.positionColumn.destroyComponents();
		this.$.pitcherColumn.destroyComponents();
		this.addSection(this.$.positionColumn, "Position Players", parsed.positionPlayers);
		this.addSection(this.$.pitcherColumn, "Pitchers", parsed.pitchers);
		this.$.positionColumn.render();
		this.$.pitcherColumn.render();
	},
	addSection : function (column, label, players) {
		if (!players.length) {
			return;
		}
		column.createComponent({ className : "absRosterSectionHeader", content : label });
		for (var i = 0; i < players.length; i++) {
			var row = column.createComponent({
				kind : "mlb.AbsPlayerRow",
				onclick : "rowClicked"
			});
			row.setPlayer(players[i]);
		}
	},
	playerRowClicked : function (inSender) {
		var player = inSender.player;
		if (player && this.owner && this.owner.showPlayerStats) {
			this.owner.showPlayerStats(player, this.currentTeam);
		}
	}
});

// ---------------------------------------------------------------------------
// Pane: tapped player's year-by-year stats. Built as a raw HTML table via
// enyo.HtmlContent -- same "CSS-table technique" already established by
// views/GamedayLinescore.js's scoreTable/lib/parsers/AbsChallengeFormat.js's
// challengeRow, appropriate here too since this is plain tabular data with
// no per-row interactivity needed (unlike the roster list above, which
// needs real per-row tap targets).
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.AbsPlayerStats",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [ {
		name : "header",
		kind : "mlb.GenericWebViewHeader",
		flex : 0
	}, {
		name : "playerHeader",
		kind : "enyo.HFlexBox",
		align : "center",
		className : "absPlayerStatsHeader",
		components : [
			{ name : "headshot", kind : "Image", className : "absPlayerStatsHeadshot" },
			{ kind : "enyo.VFlexBox", components : [
				{ name : "name", className : "absPlayerStatsName" },
				{ name : "meta", className : "absPlayerStatsMeta" }
			] }
		]
	}, {
		name : "scroller",
		kind : "enyo.Scroller",
		flex : 1,
		components : [ {
			name : "content",
			kind : "enyo.HtmlContent",
			className : "absPlayerStatsContent"
		} ]
	}, {
		kind : "Toolbar",
		height : "40px",
		flex : 0,
		components : [ { kind : "GrabButton" } ]
	}, {
		name : "getYearByYear",
		kind : "AbsPlayerYearByYearStatsAPIService",
		onSuccess : "gotYearByYear",
		onFailure : "yearByYearFailed"
	} ],

	currentPlayer : null,

	loadPlayer : function (player, team) {
		this.currentPlayer = player;
		this.$.header.$.title.setContent(player.name);
		this.$.name.setContent(player.name);
		this.$.meta.setContent((player.positionAbbr || "") + (team ? (" | " + team.name) : ""));
		this.$.headshot.setSrc(this.getHeadshotUrl(player.id));
		this.$.content.setContent('<div class="absPlayerStatsLoading">Loading...</div>');
		main.showMiddleSpinner();
		this.$.getYearByYear.urlParams = {
			personId : player.id,
			group : player.isPitcher ? "pitching" : "hitting"
		};
		this.$.getYearByYear.call();
	},

	getHeadshotUrl : function (id) {
		return "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/"
			+ id + "/headshot/67/current";
	},

	gotYearByYear : function (inSender, inResponse) {
		main.hideMiddleSpinner();
		try {
			var rows = AbsTeamsParser.parseYearByYear(inResponse);
			this.renderTable(rows);
		} catch (e) {
			console.log("AbsPlayerStats gotYearByYear parse error: " + e);
			this.$.content.setContent('<div class="absPlayerStatsLoading">No stats available.</div>');
		}
	},
	yearByYearFailed : function (inSender, inResponse) {
		main.hideMiddleSpinner();
		console.log("AbsPlayerStats yearByYearFailed: " + JSON.stringify(inResponse).substring(0, 300));
		this.$.content.setContent('<div class="absPlayerStatsLoading">No stats available.</div>');
	},

	renderTable : function (rows) {
		if (!rows.length) {
			this.$.content.setContent('<div class="absPlayerStatsLoading">No stats available.</div>');
			return;
		}
		var isPitcher = !!(this.currentPlayer && this.currentPlayer.isPitcher);
		var html = '<table class="absPlayerStatsTable"><tr>' +
			'<th>Year</th><th>Team</th>' +
			(isPitcher ?
				'<th>ERA</th><th>W</th><th>L</th><th>SO</th><th>WHIP</th><th>SV</th><th>G</th>' :
				'<th>AVG</th><th>HR</th><th>RBI</th><th>OBP</th><th>SLG</th><th>OPS</th><th>G</th>') +
			'</tr>';
		for (var i = 0; i < rows.length; i++) {
			var row = rows[i];
			var s = isPitcher ? AbsTeamsParser.formatPitchingStats(row.stat) : AbsTeamsParser.formatBattingStats(row.stat);
			html += '<tr>' +
				'<td>' + enyo.string.escapeHtml(String(row.season)) + '</td>' +
				'<td>' + enyo.string.escapeHtml(row.team) + '</td>' +
				(isPitcher ?
					('<td>' + s.era + '</td><td>' + s.wins + '</td><td>' + s.losses + '</td><td>' + s.strikeOuts + '</td><td>' + s.whip + '</td><td>' + s.saves + '</td><td>' + s.gamesPlayed + '</td>') :
					('<td>' + s.avg + '</td><td>' + s.homeRuns + '</td><td>' + s.rbi + '</td><td>' + s.obp + '</td><td>' + s.slg + '</td><td>' + s.ops + '</td><td>' + s.gamesPlayed + '</td>')) +
				'</tr>';
		}
		html += '</table>';
		this.$.content.setContent(html);
	}
});

// ---------------------------------------------------------------------------
// Outer orchestrator -- registered as the "Teams" top-level pane (see
// views/Panels2.js's panes and views/Main.js's Views registry, both
// alongside Scoreboard/Standings/News/AbsStats). Thin SlidingPane wrapper
// around the three panes above, same shape as views/AbsStatsView.js's own
// mlb.AbsStatsView orchestrator (and views/GamedayView.js's mlb.GamedayPane)
// -- mlb.AbsTeamGrid.teamTileClicked/mlb.AbsTeamRoster.playerRowClicked
// both already just call this.owner.showTeamRoster/showPlayerStats
// generically, so nothing in those kinds needed to change when this got
// pulled out from under mlb.AbsStatsView into its own top-level view --
// their "owner" is simply this kind instead now.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.TeamsView",
	kind : "SlidingPane",
	flex : 1,
	multiViewMinWidth : 0,
	components : [ {
		name : "teamsGridPane",
		width : "824px",
		components : [ {
			name : "teamsGrid",
			kind : "mlb.AbsTeamGrid",
			flex : 1
		} ]
	}, {
		name : "teamRosterPane",
		components : [ {
			name : "teamRoster",
			kind : "mlb.AbsTeamRoster",
			flex : 1
		} ]
	}, {
		name : "playerStatsPane",
		components : [ {
			name : "playerStats",
			kind : "mlb.AbsPlayerStats",
			flex : 1
		} ]
	} ],

	// Always reset back to the team grid, same "always reset to the entry
	// pane" spec as mlb.NewsView.show/mlb.AbsStatsView.show.
	show : function() {
		this.$.teamsGridPane.select();
	},

	// mlb.AbsTeamGrid's generic tap hook -- see that kind's own comment.
	teamTileTapped : function(team) {
		this.showTeamRoster(team);
	},
	showTeamRoster : function(team) {
		this.$.teamRoster.loadTeam(team);
		this.$.teamRosterPane.select();
	},
	showPlayerStats : function(player, team) {
		this.$.playerStats.loadPlayer(player, team);
		this.$.playerStatsPane.select();
	}
});
