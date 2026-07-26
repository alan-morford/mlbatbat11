// Baserunner diamond, native. Driven by lib/parsers/GamedayParser.js's
// already-parsed onFirst/onSecond/onThird booleans (from
// liveData.linescore.offense) -- that data already existed in the parser
// output before this view was written, just unused until now.
//
// Pure CSS: three small squares rotated 45deg to look diamond-shaped,
// absolutely positioned (base position values loosely modeled on the
// original 2011 app's leftover, unused #fullScoreboard-template CSS in
// css/ScoreboardView.css's .menOnBase rules). Deliberately NOT an image --
// that original CSS relied on a hotlinked http://mlb.mlb.com/images/
// scoreboard/runners.png sprite, the same dead-CDN pattern as the SVG
// team-logo mistake earlier in this project, and there's no local asset to
// use instead (checked all of imgs/, nothing diamond/base-related exists).
// Occupied/empty state is just a background-color swap.
enyo.kind({
	name : "mlb.GamedayDiamond",
	kind : "enyo.Control",
	className : "gamedayDiamond",
	components : [
		{ name : "second", className : "gamedayBase gamedayBaseSecond" },
		{ name : "first", className : "gamedayBase gamedayBaseFirst" },
		{ name : "third", className : "gamedayBase gamedayBaseThird" }
	],
	setRunners : function(onFirst, onSecond, onThird) {
		this.setBaseOccupied(this.$.first, onFirst);
		this.setBaseOccupied(this.$.second, onSecond);
		this.setBaseOccupied(this.$.third, onThird);
	},
	setBaseOccupied : function(base, occupied) {
		if (occupied) {
			base.addClass("occupied");
		} else {
			base.removeClass("occupied");
		}
	}
});
