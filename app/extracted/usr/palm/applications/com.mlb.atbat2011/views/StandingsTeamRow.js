// One team row in the native Standings list. See views/StandingsList.js and
// lib/parsers/StandingsParser.js.
enyo.kind({
	name : "mlb.StandingsTeamRow",
	kind : "enyo.HFlexBox",
	className : "standingsTeamRow",
	published : {
		team : null
	},
	components : [
		{ name : "teamName", className : "standingsTeamName", flex : 1 },
		{ name : "wins", className : "standingsCol" },
		{ name : "losses", className : "standingsCol" },
		{ name : "pct", className : "standingsCol" },
		{ name : "gb", className : "standingsCol" },
		{ name : "streak", className : "standingsCol" }
	],
	setTeam : function(team, gbField) {
		this.team = team;
		this.$.teamName.setContent(team.name);
		this.$.wins.setContent(String(team.wins));
		this.$.losses.setContent(String(team.losses));
		this.$.pct.setContent(team.pct);
		this.$.gb.setContent(String(team[gbField || "gamesBack"]));
		this.$.streak.setContent(team.streak);
	}
});
