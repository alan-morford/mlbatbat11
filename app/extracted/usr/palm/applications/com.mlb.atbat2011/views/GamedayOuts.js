// Outs indicator, native. Driven by lib/parsers/GamedayParser.js's
// already-parsed linescore.outs (from liveData.linescore) -- same source
// data views/GamedayLinescore.js's situation line already reads, just
// rendered as its own visual indicator here too. Sits next to
// views/GamedayDiamond.js's bases in views/GamedayView.js's topBar.
//
// Pure CSS, same language as GamedayDiamond: three small circles, empty
// (white) until an out is recorded, filling the same occupied-yellow a
// base does -- just circular instead of rotated-square, and laid out in
// a simple row instead of diamond positions.
enyo.kind({
	name : "mlb.GamedayOuts",
	kind : "enyo.HFlexBox",
	className : "gamedayOuts",
	pack : "center",
	align : "center",
	components : [
		{ name : "out1", className : "gamedayOut" },
		{ name : "out2", className : "gamedayOut" },
		{ name : "out3", className : "gamedayOut" }
	],
	setOuts : function(outs) {
		outs = outs || 0;
		this.setOutOccupied(this.$.out1, outs >= 1);
		this.setOutOccupied(this.$.out2, outs >= 2);
		this.setOutOccupied(this.$.out3, outs >= 3);
	},
	setOutOccupied : function(out, occupied) {
		if (occupied) {
			out.addClass("occupied");
		} else {
			out.removeClass("occupied");
		}
	}
});
