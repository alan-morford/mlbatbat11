// Batter/pitcher headshot + label + name + stat line, native. Driven by
// lib/parsers/GamedayParser.js's parseMatchup() output. One reusable
// layout for both "Now Batting" and "Now Pitching", with an optional
// `reverse` flag (info block before the headshot instead of after) for
// the pitcher card, which sits mirrored at the right edge of
// gamedayLeftColumn. Built by creating headshot/info in whichever order
// `reverse` calls for in create() (see below), NOT via a CSS
// -webkit-box-direction:reverse toggle on the outer box -- confirmed live
// that approach reordered the OUTER headshot/info pair correctly but also
// visibly disturbed the INNER info VFlexBox's own label/name/statLine
// order, which should have been a completely separate, unrelated axis.
// Actually reordering the DOM removes that whole class of uncertainty.
//
// Headshot uses the same Image kind + setSrc(url) pattern already proven
// for team logos in views/ScoreboardGameBox.js, just pointed at MLB's own
// headshot CDN (confirmed live, 200/image/jpeg, no auth needed) instead of
// ESPN's team-logo CDN. Unlike that logo pattern, a personId isn't
// guaranteed to have a real photo (e.g. a brand-new call-up) -- same risk
// tolerance as the existing logo code, which also has no broken-image
// fallback; not a new regression introduced here.
enyo.kind({
	name : "mlb.GamedayPlayerCard",
	kind : "enyo.HFlexBox",
	className : "gamedayPlayerCard",
	align : "center",
	published : {
		label : "",
		statType : "batting", // "batting" | "pitching"
		reverse : false // true = headshot rendered after the info block instead of before
	},
	create : function() {
		this.inherited(arguments);
		var headshotConfig = { name : "headshot", kind : "Image", className : "gamedayPlayerHeadshot" };
		var infoConfig = { kind : "enyo.VFlexBox", className : "gamedayPlayerInfo", components : [
			{ name : "label", className : "gamedayPlayerLabel" },
			{ name : "name", className : "gamedayPlayerName" },
			{ name : "statLine", className : "gamedayPlayerStatLine" }
		]};
		if (this.reverse) {
			this.createComponent(infoConfig);
			this.createComponent(headshotConfig);
			// Purely cosmetic (right-aligns the info text) -- NOT used for
			// structural reordering, unlike the earlier box-direction
			// attempt this replaced. See .gamedayPlayerCardReversed in
			// css/GamedayView.css.
			this.addClass("gamedayPlayerCardReversed");
		} else {
			this.createComponent(headshotConfig);
			this.createComponent(infoConfig);
		}
		this.$.label.setContent(this.label);
	},
	setPlayer : function(player) {
		if (!player) {
			this.hide();
			return;
		}
		this.show();
		this.$.headshot.setSrc(this.getHeadshotUrl(player.id));
		this.$.name.setContent(player.name);
		this.$.statLine.setContent(this.formatStatLine(player.stats));
	},
	getHeadshotUrl : function(id) {
		return "https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png,q_auto:best,f_auto/v1/people/"
			+ id + "/headshot/67/current";
	},
	formatStatLine : function(stats) {
		stats = stats || {};
		if (this.statType === "pitching") {
			return "ERA " + stats.era + " | " + stats.wins + "-" + stats.losses + " | " + stats.strikeOuts + " K";
		}
		return "AVG " + stats.avg + " | " + stats.homeRuns + " HR | " + stats.rbi + " RBI";
	}
});
