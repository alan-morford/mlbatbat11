/**
 * Landscape orientation lock that works on every webOS tablet.
 *
 * The original 2011 app hard-coded enyo.setAllowedOrientation("right"),
 * which is landscape only on the portrait-native 9.7" TouchPad. On the
 * landscape-native TouchPad Go, "right" is a 90-degree turn. Worse, the
 * orientation *names* aren't stable even across one device: a Go running
 * LunaCE (a TouchPad-built LunaSysMgr) labels its upright landscape
 * differently than stock Go Luna does. So no hard-coded name works
 * everywhere, and neither does deviceInfo (both tablets report 1024x768).
 *
 * What is reliable (all confirmed on-device):
 *   - PalmSystem.screenOrientation at launch is Luna's current UI
 *     orientation, i.e. how the tablet is being held.
 *   - The window's size is NOT trustworthy before the lock takes effect
 *     (a TouchPad reported a portrait window while Luna said "right"),
 *     but it is once the lock has applied: a resize arrives ~1s in.
 * So: lock to Luna's launch orientation, then check the real window shape.
 * If the window came out portrait (the tablet was held in portrait, or Luna
 * kept a stale orientation while it lay flat), switch to the other pair.
 *
 * After that, follow 180-degree flips (never portrait) using the
 * accelerometer's "orientationchange" event; see _onOrientationChange.
 */
var Orientation = {};

// Used only when nothing usable is reported (e.g. desktop browser).
Orientation.LEGACY_DEFAULT = "right";

// Clockwise order -- the same cycle Luna's own TouchPad remap steps through.
Orientation.CYCLE = [ "up", "right", "down", "left" ];

// When the geometry check runs, measured from page load (timers only start
// firing once the app has finished loading).
Orientation.VERIFY_MS = 1000;

// How long the other landscape orientation must hold before re-locking.
// Re-locking mid-turn makes Luna rotate, snap back and rotate again
// (confirmed on-device), so wait for the tablet to settle.
Orientation.SETTLE_MS = 500;

Orientation._current = null;
Orientation._pair = null;
Orientation._verified = false;
Orientation._offset = null;
Orientation._lastPosition = null;
Orientation._lastRaw = null;
Orientation._pending = null;

Orientation._isName = function( o ) {
	return Orientation.CYCLE.indexOf( o ) !== -1;
};

Orientation._pairOf = function( o ) {
	return ( o === "up" || o === "down" ) ? [ "up", "down" ] : [ "left", "right" ];
};

Orientation._rotate = function( name, steps ) {
	var i = Orientation.CYCLE.indexOf( name );
	return Orientation.CYCLE[ ( i + steps + 4 ) % 4 ];
};

Orientation._screenOrientation = function() {
	try {
		return window.PalmSystem ? PalmSystem.screenOrientation : undefined;
	} catch (e) {
		return undefined;
	}
};

Orientation.lockLandscape = function() {
	var o = Orientation._screenOrientation();
	var choice = Orientation._isName( o ) ? o : Orientation.LEGACY_DEFAULT;
	Orientation._log( "launch screenOrientation=" + o + " -> " + choice );
	Orientation._launchSo = o;
	Orientation._current = choice;
	Orientation._pair = Orientation._pairOf( choice );
	enyo.setAllowedOrientation( choice );

	window.addEventListener( "resize", Orientation._verify, false );
	setTimeout( Orientation._verify, Orientation.VERIFY_MS );
	document.addEventListener( "orientationchange", Orientation._onOrientationChange, false );
	Orientation._lockedAt = Date.now();
	setInterval( Orientation._tick, Orientation.TICK_MS );
};

// Confirm the locked orientation actually produced a landscape window.
// Runs once on the first resize (the lock taking effect) or the fallback
// timer (no resize because the window was already that shape).
Orientation._verify = function() {
	if ( Orientation._verified ) {
		return;
	}
	var w = window.innerWidth, h = window.innerHeight;
	if ( !w || !h || w === h ) {
		return;
	}
	Orientation._verified = true;
	if ( w > h ) {
		Orientation._log( "verified " + Orientation._current + " is landscape (" + w + "x" + h + ")" );
		return;
	}
	// Luna's launch orientation came out portrait. On LunaCE on a 9.7"
	// TouchPad that is how it always comes out: screenOrientation reports
	// Luna's internal names, a quarter turn (clockwise in CYCLE) from the
	// names setWindowOrientation takes (confirmed on-device: held upside
	// down it reported "down", which is "left" to the window). It also
	// happens if the tablet was simply held in portrait at launch; any
	// landscape is fine then. Either way, rotate by that quarter turn.
	Orientation._skew = 1;
	var launch = Orientation._launchSo;
	var target = Orientation._isName( launch ) ? Orientation._rotate( launch, 1 ) :
		Orientation._rotate( Orientation._current, 1 );
	Orientation._pair = Orientation._pairOf( target );
	Orientation._log( Orientation._current + " is portrait (" + w + "x" + h + "), switching to " + target );
	Orientation._flipTo( target );
};

// How the tablet is held right now, in setWindowOrientation's names, if
// known. Both sources below give screenOrientation's names first; _skew
// converts those to the window's (see _verify).
Orientation._heldUi = function() {
	var held;
	if ( Orientation._soLive ) {
		held = Orientation._screenOrientation();
	} else if ( Orientation._offset !== null && Orientation._lastRaw ) {
		held = Orientation._rotate( Orientation._lastRaw, Orientation._offset );
	}
	return Orientation._isName( held ) ? Orientation._rotate( held, Orientation._skew ) : null;
};

// Two ways to know how the tablet is held, depending on the Luna build:
//
// 1. On TouchPad Luna (stock and LunaCE), PalmSystem.screenOrientation
//    keeps following the tablet even while the window is locked (confirmed
//    on-device). That is Luna's own debounced orientation, so use it once
//    we've seen it change while the lock stayed put.
// 2. On LunaCE on a Go it just follows the lock. There, use
//    the accelerometer's "orientationchange" event instead. Its position
//    (0/1 = face up/down, 2..5 = up/down/left/right) is the raw sensor
//    reading, before Luna's per-device remap into UI names. The remap is
//    a fixed rotation, so learn it once by pairing the first non-flat
//    reading with Luna's orientation at that moment.
//
// Either way, a 250ms tick decides, and only re-locks once the other
// landscape orientation has held for SETTLE_MS.
Orientation.POSITION_NAMES = { 2: "up", 3: "down", 4: "left", 5: "right" };
Orientation.TICK_MS = 250;
// Ignore screenOrientation changes this soon after a re-lock: Luna may
// still be catching up with it.
Orientation.LOCK_GRACE_MS = 2000;

Orientation._soLive = false;
Orientation._soRef = null;
Orientation._skew = 0;
Orientation._launchSo = null;
Orientation._lockedAt = 0;
Orientation._pendingSince = 0;
Orientation._lastLogged = "";

Orientation._onOrientationChange = function( e ) {
	try {
		if ( e.position === Orientation._lastPosition ) {
			return;
		}
		Orientation._lastPosition = e.position;
		var raw = Orientation.POSITION_NAMES[ e.position ];
		Orientation._lastRaw = raw || null;
		if ( raw && Orientation._offset === null ) {
			var ui = Orientation._screenOrientation();
			if ( !Orientation._isName( ui ) ) {
				ui = raw;
			}
			Orientation._offset = ( Orientation.CYCLE.indexOf( ui ) - Orientation.CYCLE.indexOf( raw ) + 4 ) % 4;
			Orientation._log( "calibrated: raw " + raw + " = ui " + ui + ", offset " + ( Orientation._offset * 90 ) + "deg" );
		}
	} catch (err) {}
};

Orientation._tick = function() {
	try {
		var now = Date.now();
		var so = Orientation._screenOrientation();
		if ( !Orientation._soLive && Orientation._isName( so ) &&
				now - Orientation._lockedAt > Orientation.LOCK_GRACE_MS ) {
			if ( Orientation._soRef === null ) {
				Orientation._soRef = so;
			} else if ( so !== Orientation._soRef ) {
				Orientation._soLive = true;
				Orientation._log( "screenOrientation follows the tablet (" + Orientation._soRef + " -> " + so +
					" while locked " + Orientation._current + "), using it" );
			}
		}

		var held = Orientation._heldUi();
		var pair = Orientation._pair;
		var wanted = ( held === pair[0] || held === pair[1] ) && held !== Orientation._current ? held : null;

		var state = "held=" + held + " raw=" + Orientation._lastRaw + " so=" + so + " locked=" + Orientation._current;
		if ( state !== Orientation._lastLogged ) {
			Orientation._lastLogged = state;
			Orientation._log( state );
		}

		if ( !wanted ) {
			Orientation._pending = null;
			return;
		}
		if ( Orientation._pending !== wanted ) {
			Orientation._pending = wanted;
			Orientation._pendingSince = now;
			return;
		}
		if ( now - Orientation._pendingSince >= Orientation.SETTLE_MS ) {
			Orientation._pending = null;
			Orientation._flipTo( wanted );
		}
	} catch (err) {}
};

Orientation._flipTo = function( o ) {
	Orientation._log( "flipping to " + o );
	Orientation._current = o;
	Orientation._lockedAt = Date.now();
	Orientation._soRef = null;
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
