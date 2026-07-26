// Home-plate pitch-location plot, native. Driven by
// lib/parsers/GamedayParser.js's parseCurrentAtBatPitches() output (new --
// there was no prior parsing or rendering of pitch-level data anywhere in
// this project or cbssports before this).
//
// Pure CSS/DOM: a fixed-size box with a bordered rectangle for the strike
// zone and small colored dots for each pitch of the current at-bat,
// positioned via a simple linear feet-to-pixel mapping. No canvas, no SVG,
// no image -- same reasoning as views/GamedayDiamond.js (nothing here has
// been confirmed to render on this old WebKit except plain CSS box
// positioning, which is used throughout this whole restoration already).
//
// Coordinate window is fixed regardless of the actual pitch data: pX -2.5..2.5
// ft maps to 0..VIEW_WIDTH px, pZ 5.0..0.0 ft (inverted -- higher pZ is
// higher up on screen, i.e. a smaller CSS `top`) maps to 0..VIEW_HEIGHT px.
//
// Dots are created/destroyed on a dedicated "dotsContainer" child, not on
// `this` directly: the proven-safe pattern elsewhere in this app
// (views/ScoreboardList.js's gamesContainer, views/GamedayLinescore.js's
// inningsRow/awayRow/homeRow) always destroys/creates/renders a CHILD
// sub-component, never the containing kind's own `this`. An earlier version
// of views/ScoreboardList.js called this.render() on itself directly and
// rendered nothing at all -- same mistake, not repeating it here.
enyo.kind({
	name : "mlb.GamedayPitchZone",
	kind : "enyo.Control",
	className : "gamedayPitchZone",

	VIEW_WIDTH : 325,  // was 260 -- +25%, matches css/GamedayView.css's .gamedayPitchZone
	VIEW_HEIGHT : 388, // was 310 -- +25%, matches css/GamedayView.css's .gamedayPitchZone
	PX_MIN : -2.5,
	PX_MAX : 2.5,
	PZ_MIN : 0,
	PZ_MAX : 5.0,
	PLATE_HALF_WIDTH : 0.83,

	components : [
		{ name : "zoneRect", className : "gamedayStrikeZoneRect" },
		{ name : "dotsContainer", className : "gamedayPitchDotsContainer" }
	],

	mapX : function(pX) {
		var ratio = (pX - this.PX_MIN) / (this.PX_MAX - this.PX_MIN);
		return ratio * this.VIEW_WIDTH;
	},
	mapZ : function(pZ) {
		var ratio = (pZ - this.PZ_MIN) / (this.PZ_MAX - this.PZ_MIN);
		return this.VIEW_HEIGHT - (ratio * this.VIEW_HEIGHT);
	},

	setPitches : function(currentAtBat) {
		if (!currentAtBat) {
			return;
		}

		var zoneLeft = this.mapX(-this.PLATE_HALF_WIDTH);
		var zoneRight = this.mapX(this.PLATE_HALF_WIDTH);
		var zoneTop = this.mapZ(currentAtBat.strikeZoneTop);
		var zoneBottom = this.mapZ(currentAtBat.strikeZoneBottom);

		this.$.zoneRect.applyStyle("left", zoneLeft + "px");
		this.$.zoneRect.applyStyle("top", zoneTop + "px");
		this.$.zoneRect.applyStyle("width", (zoneRight - zoneLeft) + "px");
		this.$.zoneRect.applyStyle("height", (zoneBottom - zoneTop) + "px");

		this.$.dotsContainer.destroyComponents();

		var pitches = currentAtBat.pitches || [];
		for (var i = 0; i < pitches.length; i++) {
			this.createPitchDot(pitches[i]);
		}
		this.$.dotsContainer.render();
	},

	createPitchDot : function(pitch) {
		// -10, not -5 -- half of .gamedayPitchDot's 20px size (doubled from
		// 10px), so the dot stays centered on its actual pitch coordinate
		// instead of shifting down-right by 5px.
		var dotLeft = this.mapX(pitch.pX) - 10;
		var dotTop = this.mapZ(pitch.pZ) - 10;

		this.$.dotsContainer.createComponent({
			className : "gamedayPitchDot " + this.getPitchResultClass(pitch),
			style : "left:" + dotLeft + "px; top:" + dotTop + "px;"
		});
	},

	getPitchResultClass : function(pitch) {
		if (pitch.isInPlay) {
			return "pitchInPlay";
		}
		if (pitch.isBall) {
			return "pitchBall";
		}
		if (pitch.isStrike) {
			return "pitchStrike";
		}
		return "pitchFoul";
	}
});
