/**
 * Best-effort on-device logger for debugging without a console (Claude only
 * has WSL access to this project; the TouchPad and its USB/novacom console
 * belong to Windows). Tries, in order:
 *   1. The webOS/WebKit FileSystem API, appending to /media/internal/sports.log
 *      -- readable directly off the device when mounted as USB storage.
 *   2. localStorage, as a rolling buffer, if the FileSystem API isn't there
 *      or errors out.
 * Every line is also mirrored to console.log/enyo.log, so it still shows up
 * in `palm-log` if you're plugged in and watching from the Windows side.
 * Never throws -- a logging failure must not be able to break the app.
 */
var SportsLogger = {};

// Off by default for a real release build -- flip to true only for an
// on-device debugging session. When false, log() is a no-op and init()
// never attempts to open /media/internal/sports.log at all, so a normal
// release doesn't write anything to the device's filesystem or the
// localStorage fallback.
SportsLogger.ENABLED = false;

SportsLogger._writer = null;
SportsLogger._fileReady = false;
SportsLogger._fileFailed = false;
SportsLogger._buffer = [];
SportsLogger._maxBufferedLines = 500;

SportsLogger.init = function() {
	try {
		if ( !window.resolveLocalFileSystemURI ) {
			SportsLogger._fileFailed = true;
			return;
		}

		window.resolveLocalFileSystemURI( "/media/internal/", function( dirEntry ) {
			dirEntry.getFile( "sports.log", { create: true }, function( fileEntry ) {
				fileEntry.createWriter( function( writer ) {
					SportsLogger._writer = writer;
					SportsLogger._fileReady = true;
					SportsLogger._flushBufferToFile();
				}, SportsLogger._onFileError );
			}, SportsLogger._onFileError );
		}, SportsLogger._onFileError );
	} catch (e) {
		SportsLogger._onFileError(e);
	}
};

SportsLogger._onFileError = function( e ) {
	SportsLogger._fileFailed = true;
	var reason = e ? ( e.message || e.code || e ) : "unknown";
	console.log( "SportsLogger: /media/internal/sports.log unavailable (" + reason + "), using localStorage fallback" );
};

SportsLogger.log = function( tag, message ) {
	if ( !SportsLogger.ENABLED ) {
		return;
	}
	var line = "[" + new Date().toISOString() + "] [" + tag + "] " + message;

	try { console.log( line ); } catch (e) {}
	try { if ( window.enyo && enyo.log ) enyo.log( line ); } catch (e) {}

	if ( SportsLogger._fileReady ) {
		SportsLogger._writeToFile( line + "\n" );
	} else if ( SportsLogger._fileFailed ) {
		SportsLogger._writeToLocalStorage( line );
	} else {
		// FileSystem API resolution is still pending; buffer until it settles.
		SportsLogger._buffer.push( line );
	}
};

SportsLogger._writeToFile = function( text ) {
	try {
		var writer = SportsLogger._writer;
		writer.seek( writer.length );
		writer.write( new Blob( [ text ], { type: "text/plain" } ) );
	} catch (e) {
		console.log( "SportsLogger: file write failed (" + ( e.message || e ) + ")" );
	}
};

SportsLogger._flushBufferToFile = function() {
	if ( SportsLogger._buffer.length == 0 ) return;
	var text = SportsLogger._buffer.join( "\n" ) + "\n";
	SportsLogger._buffer = [];
	SportsLogger._writeToFile( text );
};

SportsLogger._writeToLocalStorage = function( line ) {
	try {
		var existing = localStorage["sportsLog"] || "";
		var lines = existing.length ? existing.split( "\n" ) : [];
		lines.push( line );
		if ( lines.length > SportsLogger._maxBufferedLines )
			lines = lines.slice( lines.length - SportsLogger._maxBufferedLines );
		localStorage["sportsLog"] = lines.join( "\n" );
	} catch (e) {}
};

if ( SportsLogger.ENABLED ) {
	SportsLogger.init();
}
