// Native standings table, replacing the old WebView pointed at
// http://wap.mlb.com/atbat/palm/standings/ (dead, DNS doesn't resolve).
// Renders a list of division-or-league groups (see
// lib/parsers/StandingsParser.js), each with a header row and team rows.
// Not a VirtualList -- same lesson as views/ScoreboardList.js: this is a
// small, fixed-size table (30 teams max), not a long recyclable list.
enyo.kind({
	name : "mlb.StandingsList",
	kind : "enyo.VFlexBox",
	flex : 1,
	published : {
		groups : [],
		gbField : "gamesBack"
	},
	components : [
		{
			name : "groupsContainer",
			className : "standingsGroupsContainer"
		}
	],
	setGroups : function(groups, gbField) {
		this.groups = groups || [];
		this.gbField = gbField || "gamesBack";

		this.$.groupsContainer.destroyComponents();
		for (var i = 0; i < this.groups.length; i++) {
			this.renderGroup(this.groups[i]);
		}
		this.$.groupsContainer.render();
	},
	renderGroup : function(group) {
		var groupBox = this.$.groupsContainer.createComponent({
			className : "standingsGroup"
		});

		groupBox.createComponent({
			className : "standingsGroupHeader",
			content : group.divisionName || group.leagueName
		});

		var headerRow = groupBox.createComponent({
			kind : "enyo.HFlexBox",
			className : "standingsHeaderRow"
		});
		headerRow.createComponent({ className : "standingsTeamName", flex : 1, content : "" });
		headerRow.createComponent({ className : "standingsCol", content : "W" });
		headerRow.createComponent({ className : "standingsCol", content : "L" });
		headerRow.createComponent({ className : "standingsCol", content : "PCT" });
		headerRow.createComponent({
			className : "standingsCol",
			content : (this.gbField === "wildCardGamesBack") ? "WCGB" : "GB"
		});
		headerRow.createComponent({ className : "standingsCol", content : "STRK" });

		for (var i = 0; i < group.teams.length; i++) {
			var row = groupBox.createComponent({ kind : "mlb.StandingsTeamRow" });
			row.setTeam(group.teams[i], this.gbField);
		}
	}
});
