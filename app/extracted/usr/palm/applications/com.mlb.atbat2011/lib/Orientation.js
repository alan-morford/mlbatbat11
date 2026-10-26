/**
 * Landscape orientation lock that works on every webOS tablet.
 *
 * The original 2011 app hard-coded enyo.setAllowedOrientation("right"),
 * which is landscape only on the portrait-native 9.7" TouchPad. On the
 * landscape-native TouchPad Go, "right" is a portrait-ish 90-degree turn
 * (home button on the right). Worse, the orientation *names* aren't stable
 * even across one device: a Go running LunaCE (a TouchPad-built
 * LunaSysMgr) labels its upright landscape differently than stock Go
 * Luna does. So no single hard-coded name is correct everywhere.
 *
 * Instead, derive it at launch from what the window actually reports:
 *   - PalmSystem.screenOrientation gives the current orientation name,
 *     which follows the accelerometer before any lock is applied.
 *   - The window's real width/height says whether that name is landscape.
 * From those two we know which pair of names ({up,down} or {left,right})
 * is landscape on this device/Luna combination, and lock to whichever
 * member of the pair the tablet is being held in right now. Launched
 * while held in portrait, we fall back to the pair's first member.
 */
var Orientation = {};

// Used only when nothing usable is reported (e.g. desktop browser).
Orientation.LEGACY_DEFAULT = "right";

Orientation._isName = function( o ) {
	return o === "up" || o === "down" || o === "left" || o === "right";
};

Orientation.chooseLandscape = function() {
	var o, w, h;
	try {
		o = window.PalmSystem ? PalmSystem.screenOrientation : undefined;
		w = window.innerWidth;
		h = window.innerHeight;
	} catch (e) {}

	var info = "screenOrientation=" + o + " inner=" + w + "x" + h +
		" screen=" + ( window.screen ? screen.width + "x" + screen.height : "?" );

	if ( !Orientation._isName( o ) || !w || !h || w === h ) {
		Orientation._log( info + " -> unusable, legacy " + Orientation.LEGACY_DEFAULT );
		return Orientation.LEGACY_DEFAULT;
	}

	Orientation._launchUi = o;
	var landscapeNow = w > h;
	var upDown = ( o === "up" || o === "down" );
	var upDownIsLandscape = ( upDown === landscapeNow );

	var choice;
	if ( landscapeNow ) {
		choice = o;
	} else {
		choice = upDownIsLandscape ? "up" : "right";
	}
	Orientation._log( info + " upDownIsLandscape=" + upDownIsLandscape + " -> " + choice );
	return choice;
};

Orientation.lockLandscape = function() {
	var choice = Orientation.chooseLandscape();
	Orientation._pair = ( choice === "up" || choice === "down" ) ? [ "up", "down" ] : [ "left", "right" ];
	Orientation._current = choice;
	enyo.setAllowedOrientation( choice );
	Orientation._hookDeviceRotation();
};

// Once a window is locked, Luna stops telling it about rotation through
// Mojo.screenOrientationChanged (confirmed on-device), but WebKit still
// delivers the accelerometer-driven Mojo "orientationchange" document
// event: position 0/1 = face up/down, 2..5 = up/down/left/right.
// Re-lock to the other landscape orientation when the tablet is flipped
// 180 degrees, and ignore the two portrait orientations entirely.
//
// That position is the raw sensor reading, *before* Luna's per-device
// remap into UI orientation names (identity on stock Go, 180 degrees on a
// Go running patched LunaCE, 90 degrees on the 9.7" TouchPad). The remap
// is always a fixed rotation, so learn it once: the first event reports
// the sensor state Luna's launch-time UI orientation was derived from,
// and the difference between the two is the offset for every later event.
Orientation.POSITION_NAMES = { 2: "up", 3: "down", 4: "left", 5: "right" };

// Clockwise order -- the same cycle Luna's own TouchPad remap steps through.
Orientation.CYCLE = [ "up", "right", "down", "left" ];
Orientation._offset = null;

Orientation._rotate = function( name, steps ) {
	var i = Orientation.CYCLE.indexOf( name );
	return Orientation.CYCLE[ ( i + steps + 4 ) % 4 ];
};

Orientation._hookDeviceRotation = function() {
	document.addEventListener( "orientationchange", Orientation._onOrientationChange, false );
};

// How long a flipped landscape position must hold before re-locking.
// Re-locking mid-turn makes Luna rotate, snap back and rotate again
// (confirmed on-device), so wait for the tablet to settle.
Orientation.SETTLE_MS = 500;

Orientation._lastPosition = null;
Orientation._pending = null;
Orientation._timer = null;

Orientation._onOrientationChange = function( e ) {
	try {
		// Events arrive ~15/s; only act (and log) when the position changes.
		if ( e.position === Orientation._lastPosition ) {
			return;
		}
		Orientation._lastPosition = e.position;

		var raw = Orientation.POSITION_NAMES[ e.position ];
		if ( raw && Orientation._offset === null ) {
			var ui = Orientation._isName( Orientation._launchUi ) ? Orientation._launchUi : raw;
			Orientation._offset = ( Orientation.CYCLE.indexOf( ui ) - Orientation.CYCLE.indexOf( raw ) + 4 ) % 4;
			Orientation._log( "calibrated: raw " + raw + " = ui " + ui + ", offset " + ( Orientation._offset * 90 ) + "deg" );
		}
		var o = raw ? Orientation._rotate( raw, Orientation._offset ) : undefined;
		var pair = Orientation._pair;
		var wanted = ( o === pair[0] || o === pair[1] ) ? o : null;

		Orientation._log( "orientationchange position=" + e.position + " raw=" + raw + " ui=" + o +
			" pitch=" + e.pitch + " roll=" + e.roll + " locked=" + Orientation._current );

		Orientation._cancelPending();
		if ( !wanted || wanted === Orientation._current ) {
			return;
		}
		Orientation._pending = wanted;
		Orientation._timer = setTimeout( function() {
			Orientation._timer = null;
			if ( Orientation._pending === wanted ) {
				Orientation._pending = null;
				Orientation._flipTo( wanted );
			}
		}, Orientation.SETTLE_MS );
	} catch (err) {}
};

Orientation._cancelPending = function() {
	if ( Orientation._timer ) {
		clearTimeout( Orientation._timer );
		Orientation._timer = null;
	}
	Orientation._pending = null;
};

Orientation._flipTo = function( o ) {
	Orientation._log( "flipping to " + o );
	Orientation._current = o;
	enyo.setAllowedOrientation( o );
};

Orientation._log = function( msg ) {
	try {
		if ( window.SportsLogger ) {
			SportsLogger.log( "Orientation", msg );
		} else {
			console.log( "Orientation: " + msg );
		}
	} catch (e) {}
};
