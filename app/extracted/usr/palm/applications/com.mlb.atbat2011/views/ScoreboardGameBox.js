// One game tile in the native Scoreboard grid. Deliberately plain
// (non-flexbox) Enyo controls with float-based CSS internally -- nesting
// Enyo's VFlexBox/HFlexBox (-webkit-box flex model) inside the outer
// float:left tile grid caused inconsistent row wrapping on-device (tiles
// wrapping 4/2/4/1/4/1 per row instead of a consistent 3 per row), so this
// avoids Enyo's flex kinds entirely here, matching the rest of this app's
// float-based 2011 CSS instead. Team logos are PNGs from ESPN's CDN
// (a.espncdn.com/i/teamlogos/mlb/500/{slug}.png), not MLB's own
// mlbstatic.com SVGs -- SVG-as-<img> rendering support on webOS 3.0.5's
// WebKit was unconfirmed and turned out not to work; PNG has no such risk.
enyo.kind({
	name : "mlb.ScoreboardGameBox",
	kind : "enyo.Control",
	className : "scoreboardGameBox",
	published : {
		game : null
	},
	components : [
		{
			className : "scoreboardGameBoxRow",
			components : [
				{ name : "awayLogo", kind : "Image", className : "scoreboardTeamLogo" },
				{ name : "awayTeam", className : "scoreboardTeamName" },
				{ name : "awayScore", className : "scoreboardTeamScore" }
			]
		},
		{
			className : "scoreboardGameBoxRow",
			components : [
				{ name : "homeLogo", kind : "Image", className : "scoreboardTeamLogo" },
				{ name : "homeTeam", className : "scoreboardTeamName" },
				{ name : "homeScore", className : "scoreboardTeamScore" }
			]
		},
		{ name : "statusLine", className : "scoreboardGameStatus" }
	],
	setGame : function(game) {
		this.game = game;
		if (!game) {
			return;
		}

		this.$.awayTeam.setContent(game.awayTeam.name);
		this.$.homeTeam.setContent(game.homeTeam.name);
		this.$.awayLogo.setSrc(this.getLogoUrl(game.awayTeam.abbreviation));
		this.$.homeLogo.setSrc(this.getLogoUrl(game.homeTeam.abbreviation));

		this.$.awayScore.setContent(this.formatScore(game.awayTeam.score));
		this.$.homeScore.setContent(this.formatScore(game.homeTeam.score));

		this.$.statusLine.setContent(this.getStatusText(game));
	},
	// Stats API's own abbreviation matches ESPN's logo slug for every team
	// except Arizona (Stats API "AZ" 404s on ESPN's CDN; ESPN uses "ari") --
	// see data/MLBTeamReference.js, which is generated fresh from Stats API
	// and cross-checked against every ESPN logo slug. Not routed through
	// that file's lookup here to avoid a data/ dependency in this view for
	// a single hardcoded exception.
	getLogoUrl : function(abbreviation) {
		var slug = (abbreviation === "AZ") ? "ari" : (abbreviation || "").toLowerCase();
		return "https://a.espncdn.com/i/teamlogos/mlb/500/" + slug + ".png";
	},
	formatScore : function(score) {
		// Stats API omits the score field entirely for games that haven't
		// started -- guard on the value itself, not just game.status.isPreview,
		// since not every not-yet-scored state is reliably "Preview"
		// (postponed/suspended/delayed games can land here too).
		return (typeof score === "number") ? String(score) : "";
	},
	getStatusText : function(game) {
		if (game.status.isFinal) {
			return "Final";
		}
		if (game.status.isLive) {
			var state = game.inningState ? game.inningState + " " : "";
			return state + (game.inning || "");
		}
		return game.status.detailedState || "";
	}
});
