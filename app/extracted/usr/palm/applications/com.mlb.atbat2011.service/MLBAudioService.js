/*
 * MLB At Bat 11 live radio playback service.
 *
 * webOS's HTML5 <audio> (and the com.palm.mediad MediaPlayer it routes
 * through) cannot play audio on this device: its playbin-based pipeline
 * needs the GStreamer "audioresample" element, which is absent (confirmed
 * live this session: a plain direct MP3 file failed with a decode error,
 * inline HLS failed with a network error, and even the native media player
 * failed after correctly launching, since it hits the same broken
 * pipeline). A hand-built gst-launch pipeline (filesrc -> decodebin ->
 * audioconvert -> pulsesink) plays the same audio fine -- confirmed live
 * against a real MLB broadcast before writing this file (downloaded real
 * segments over a novacom shell, concatenated them, played them with this
 * exact pipeline shape, and audibly heard the broadcast).
 *
 * This pattern, and most of this file's structure (SIGSTOP/SIGCONT pause,
 * per-stream PulseAudio volume via pactl, curl instead of gst's own network
 * source), is adapted from a working prior-art app for this exact hardware,
 * "Jukie" (github.com/achunt2143/jukie) -- see that project's own
 * JukieAudioService.js for the original, an Apple Music client.
 *
 * UNLIKE Jukie's finite, downloadable Apple Music clips, MLB's radio
 * broadcast is a LIVE, continuously-updating HLS stream with no fixed file
 * to download-then-play. This service instead runs a live relay: it polls
 * the HLS media (variant) playlist on a timer, curls each new segment as it
 * appears in strict order, and writes the bytes straight into gst-launch's
 * own stdin (fdsrc fd=0 reads it), which is a real anonymous pipe Node's
 * child_process sets up automatically -- no named FIFO file on disk.
 * Segments for the MLB radio broadcasts tested this session were plain
 * unencrypted .aac (ADTS) files -- concatenation-safe, no remuxing or
 * AES-128 decrypt needed.
 *
 * WHY CURL, NOT GST'S OWN NETWORK SOURCE: same reasoning as Jukie -- this
 * service runs inside a webOS jail whose /dev has urandom but no
 * /dev/random. GStreamer's souphttpsrc uses gnutls/libgcrypt, which aborts
 * at init in that environment ("no entropy gathering module detected" ->
 * SIGABRT) before the TLS handshake. curl's OpenSSL is happy seeding from
 * /dev/urandom, so all network fetching in this service goes through curl,
 * never gst.
 *
 * WHY fdsrc READING gst-launch's OWN STDIN, NOT A NAMED FIFO FILE (this
 * design went through two earlier, more complicated versions before
 * landing here -- worth recording why, since it's not the obvious first
 * design): the original approach created a FIFO on disk via `mkfifo` and
 * had gst's `filesrc` read it. That hit three real, live-confirmed bugs in
 * turn: (1) `filesrc` fstat()s its source to determine size/seekability,
 * and a FIFO always reports size 0, so it immediately concluded "empty"
 * and errored (gst exit 255, "Can't typefind empty stream") rather than
 * blocking for a writer -- fixed by switching to `fdsrc`, GStreamer's
 * element for pipe/socket sources, with the FIFO attached to gst-launch's
 * stdin via shell `< FIFO_PATH` redirection; (2) `mkfifo` is spawned async
 * and fire-and-forget, and a fixed delay before trusting it existed wasn't
 * reliable under load -- surfaced as "no such file" (gst exit 1); and most
 * fundamentally, (3) this device's busybox build has **no mkfifo applet at
 * all** (confirmed live: `which mkfifo`, `busybox mkfifo`, and checking
 * every plausible path all came back empty -- "applet not found"), so the
 * whole named-FIFO approach was a dead end regardless of how the timing
 * issues were handled.
 *
 * The named FIFO was only ever there to work around a *different* concern
 * -- Node directly opening a FIFO for writing (fs.openSync/writeSync)
 * blocks until a reader exists, and Node 0.4 (this service's engine) is
 * single-threaded, so doing that synchronously in-process risked freezing
 * the ENTIRE service (unable to answer pause/stop/getStatus) for as long
 * as gst took to start. That concern is real for a *named* FIFO opened via
 * a blocking syscall, but it never applied to a child process's own stdin:
 * `cp.spawn` sets up an actual anonymous pipe between Node and the child
 * atomically at spawn time (no blocking open() involved at all), so
 * `self.child.stdin.write(data)` from `_curlSegment` is exactly as safe as
 * every other stdin/stdout stream handling already used throughout this
 * file. No FIFO, no `mkfifo`, no separate persistent writer process (an
 * even earlier intermediate version had one, to keep a FIFO's write end
 * continuously open across segments) -- gst-launch's own stdin already
 * stays open for the life of the process, which is exactly what's needed.
 *
 * WHY NO AUTH HEADERS ON PLAYLIST/SEGMENT FETCHES: confirmed live this
 * session that MLB's playback URLs (from the app's initPlaybackSession
 * GraphQL call) need no bearer token, no x-cdn-token header, nothing -- the
 * URL itself is enough; adding the GraphQL response's separate `token`
 * field as a header actively broke it (403 from the Fastly edge). So this
 * service only ever needs the plain playback URL + heartbeat URL from the
 * app; it does no OAuth/GraphQL of its own. The app's WebKit networking
 * already does HTTPS reliably (proven all session for statsapi.mlb.com,
 * ESPN, etc.) -- unlike this service's jailed environment -- so Okta login
 * and the GraphQL calls live in the app (lib/OktaAuth.js,
 * lib/MLBMediaGateway.js), which just hands this service a ready-to-play
 * URL plus heartbeat info.
 *
 * HEARTBEAT: initPlaybackSession also returns heartbeatInfo {url,
 * interval} -- MLB expects a periodic ping to keep the playback session /
 * entitlement alive during long-running playback. Pinged via curl POST on
 * the given interval while playing or paused.
 *
 * UNVERIFIED FOR THIS SPECIFIC DEVICE: the PulseAudio sink name
 * ('pcm_output') is carried over from Jukie's own live-confirmed value on
 * the same platform (HP TouchPad, webOS 3.0.5), not independently
 * re-verified here. If pause (which suspends this sink) doesn't work, this
 * is the first thing to check -- `pactl list sinks short` on-device.
 */
require = IMPORTS.require;
var cp = require('child_process');
var fs = require('fs');
var http = require('http'); // video-download local file server -- see startVideoHttpServer below

var GST = '/usr/bin/gst-launch-0.10';
var CURL = '/usr/bin/curl';
var PACTL = '/usr/bin/pactl';
var OPENSSL = '/usr/bin/openssl'; // AES-128 HLS segment decryption -- see _decryptFile
var SINK = 'pcm_output'; // see "UNVERIFIED" note above
// Temp segment files go straight in /tmp (no subdirectory) -- confirmed
// live that fs.mkdirSync() for a new /tmp/mlbaudio-segments subdirectory
// was silently failing inside this jail on every single call (every
// segment fetch failed with curl's "Failure writing output to
// destination" from the very first one, since the target directory never
// actually existed) even though /tmp itself is confirmed writable by this
// process. Rather than chase the exact jail restriction, just avoid
// needing mkdir at all -- /tmp itself already exists and works.
var SEGMENT_TMP_PREFIX = '/tmp/mlbaudio-seg-';
var LIVE_EDGE_SEGMENTS = 3; // how many segments back from the live edge a live relay starts at -- see _startPipeline's comment on why starting at segment #1 was the real cause of "silent" playback all session
var VOD_START_SEGMENT_OFFSET = 1; // VOD segment index to start streaming from, not 0 -- archived games were silent even after the live-edge fix; testing whether VOD's segment #0 is the same kind of leading silence/non-audio segment as a live broadcast's earliest segments (see LIVE_EDGE_SEGMENTS)
var DEFAULT_POLL_INTERVAL_MS = 4000; // fallback if a playlist has no #EXT-X-TARGETDURATION; typical values seen live are 4-5s
var FLUSH_INTERVAL_MS = 3000; // how often buffered segments get written to gst's stdin in one batched write -- see _flushPendingSegments
var MAX_PENDING_BYTES = 400000; // flush early once this much is buffered and unflushed, to bound memory on a long VOD
var WATCHDOG_INTERVAL_MS = 1000; // how often _watchdogCheck runs -- see its comment
// How long without a status() call before the watchdog assumes the app is
// gone and stops playback. Raised from 4000 back up -- confirmed live
// (2026-08-08, via /var/log/messages) that 4000 was actively firing during
// completely normal use: switching away to a different app (backgrounding
// At Bat, not closing it) throttles its JS timers, including the 1s
// getStatus poll that resets this, and the watchdog was killing real
// in-progress playback within about 4 seconds of that -- "no status() call
// in 4000ms, assuming app is gone -- stopping playback" logged right as
// the stream cut out. The actual playback pipeline (gst-launch, segment
// fetching, all in this service, all on their own independent timers) is
// completely unaffected by the app being backgrounded -- only this
// watchdog's own trigger was ever the problem, so it's the only thing that
// needs to change. 30s is a large enough margin to survive normal
// backgrounding/throttling while switching apps or browsing elsewhere in
// this app itself, while still eventually stopping playback if the app is
// genuinely gone for good (crashed, force-closed, etc.) rather than left
// running forever.
var WATCHDOG_TIMEOUT_MS = 30000;

// Per direct user feedback (2026-08-08): gst-launch itself is already
// documented elsewhere in this file (see _startLiveRelayPipeline's own
// comment) as occasionally exiting cleanly (code 0) after a small,
// consistent number of segments for reasons never fully root-caused, even
// mid-stream with no backpressure and no explicit .end() call -- previously
// this just ended playback outright with no recovery. Auto-restarting gst
// (re-spawn only, NOT a full _kill()/new play() -- polling/segment state
// like knownSegments is left alone so playback resumes roughly where it
// left off instead of restarting the whole stream from scratch) turns that
// known failure mode into a brief stutter instead of a dead stream.
var MAX_RESTART_ATTEMPTS = 5;              // give up and report a real error after this many restarts without RESTART_ATTEMPT_RESET_MS of stable playback between them
var RESTART_ATTEMPT_RESET_MS = 120000;     // 2 minutes of stable playback since the last restart refills the attempt budget, so an early hiccup doesn't permanently reduce resilience for a multi-hour broadcast
var RESTART_DELAY_MS = 1500;               // brief pause before respawning -- avoids hammering a tight crash loop if gst is failing to start at all

// Manual concatenation, not Buffer.concat -- this Node (~0.4, 2011-era) may
// not have the static Buffer.concat helper at all.
function concatBuffers(buffers) {
	var totalLen = 0;
	for (var i = 0; i < buffers.length; i++) { totalLen += buffers[i].length; }
	var result = new Buffer(totalLen);
	var offset = 0;
	for (var j = 0; j < buffers.length; j++) {
		buffers[j].copy(result, offset);
		offset += buffers[j].length;
	}
	return result;
}

// Manual hex encoding, not Buffer#toString('hex') -- confirmed live this
// session that this Node throws "Error: Unknown encoding" for 'hex'
// (only 'utf8'/'ascii'/'base64' appear supported), same 2011-era-Node
// gap as concatBuffers above. Used to turn a fetched AES-128 key's raw
// bytes into the hex string openssl's `-K` flag expects.
function bufferToHex(buf) {
	var hex = '';
	for (var i = 0; i < buf.length; i++) {
		var b = buf[i].toString(16);
		if (b.length < 2) { b = '0' + b; }
		hex += b;
	}
	return hex;
}

// ---------------------------------------------------------------------------
// Singleton player. All command assistants run in this one Node process, so
// this object persists across Luna requests.
// ---------------------------------------------------------------------------
var MLBAudioPlayer = {
	child: null,            // gst-launch process (playback -- fdsrc fd=0 reads its own stdin, see _startPipeline/_curlSegment)
	gen: 0,                 // playback generation; bumped on every kill so a superseded async handler can't clobber current state
	state: 'idle',           // idle | downloading | playing | paused | ended | error -- see _startPipeline
	url: '',                 // the app-provided playback URL (master or media playlist)
	variantUrl: '',           // resolved media (variant) playlist URL, once known
	heartbeatUrl: '',
	heartbeatInterval: 60,    // seconds
	heartbeatTimer: null,
	pollTimer: null,
	knownSegments: {},        // segment URL -> true, so a re-polled playlist doesn't re-fetch old segments
	keyCache: {},             // AES-128 key URI -> hex key string, so a re-polled playlist doesn't re-fetch the same key -- see _getKeyHex
	pendingSegments: [],      // buffers fetched but not yet written to gst's stdin -- see _flushPendingSegments
	pendingBytes: 0,          // running total of pendingSegments' combined length
	flushTimer: null,
	playlistDrained: false,   // true once a VOD playlist has been fully fetched (see _pollOnce) -- an unexpected gst exit AFTER this point is real completion, not something to auto-restart from
	restartAttempts: 0,       // see MAX_RESTART_ATTEMPTS/_restartPipeline
	lastRestartAt: 0,         // see RESTART_ATTEMPT_RESET_MS/_restartPipeline
	lastError: '',
	volume: 100,              // 0-100, this service's OWN PulseAudio stream gain (see file header -- no reachable API for the real system volume)
	watchdogTimer: null,      // see _watchdogCheck
	lastStatusPollAt: 0,      // Date.now() of the last status() call -- fed by every app-originated command (getStatus's 1s poll, but also play/pause/resume/stop/setVolume, all of which return status()), consumed by _watchdogCheck

	// persistLog: true logs both to console AND to the persistent
	// /tmp/abs_debug.log file (absDebugLog, defined further down this file
	// -- function declarations are hoisted, so calling it from here before
	// its own textual definition is fine); omitted/false is console-only,
	// same as before. Deliberately opt-in per call site, NOT blanket for
	// every this.log(...) call in this object -- gst's own stderr handler
	// alone calls this many times PER SECOND during normal playback
	// (confirmed live, many entries within the same millisecond), and
	// absDebugLog does a full read-modify-write of the whole log file on
	// every single call (no fs.appendFileSync on this Node build -- see
	// absDebugLog's own comment) -- persisting that volume would hammer
	// the filesystem constantly and risked being a NEW cause of playback
	// trouble, not just a way to observe one. Reserved for the handful of
	// low-frequency, high-value lifecycle events (play start, kill,
	// watchdog firing, gst process exit) where persisting the JS-side
	// console.log wasn't reliably observable: live-tailing
	// /var/log/messages over novacom during a real crash-reproduction test
	// proved unreliable (the tty session silently dropped mid-test at
	// least once, and a later attempt raced the user's own actions vs.
	// when the tail actually attached, missing the actual event both
	// times) -- a persistent file read back AFTER the fact (novacom get,
	// already proven reliable elsewhere this project) sidesteps needing a
	// live connection to survive an entire test.
	log: function (msg, persistLog) {
		if (typeof console !== 'undefined' && console.log) {
			console.log('[MLBAudioPlayer] ' + msg);
		}
		if (persistLog && typeof absDebugLog === 'function') {
			absDebugLog('[MLBAudioPlayer] ' + msg);
		}
	},

	_signal: function (signame, pid) {
		pid = pid || (this.child && this.child.pid);
		if (!pid) { return; }
		try { cp.spawn('/bin/sh', ['-c', 'kill -' + signame + ' ' + pid]); }
		catch (e) { this.log('signal ' + signame + ' (' + pid + ') failed: ' + e); }
	},

	_suspendSink: function (yes) {
		try { cp.spawn(PACTL, ['suspend-sink', SINK, yes ? '1' : '0']); }
		catch (e) { this.log('suspend-sink ' + yes + ' failed: ' + e); }
	},

	_volRaw: function (pct) {
		return Math.round(Math.max(0, Math.min(100, pct)) / 100 * 65536);
	},

	_findSinkInputIndex: function (text, pid) {
		var lines = text.split('\n');
		var curIdx = null;
		for (var i = 0; i < lines.length; i++) {
			var m = lines[i].match(/^Sink Input #(\d+)/);
			if (m) { curIdx = m[1]; continue; }
			if (/^[A-Za-z]/.test(lines[i])) { curIdx = null; continue; }
			if (curIdx !== null && lines[i].indexOf('application.process.id') !== -1 &&
			    lines[i].indexOf('"' + pid + '"') !== -1) {
				return curIdx;
			}
		}
		return null;
	},

	_applyVolume: function (retriesLeft) {
		var self = this;
		if (!this.child || !this.child.pid) { return; }
		var pid = this.child.pid;
		var myGen = this.gen;
		if (retriesLeft === undefined) { retriesLeft = 5; }
		var list = cp.spawn(PACTL, ['list', 'sink-inputs']);
		var out = '';
		if (list.stdout) { list.stdout.on('data', function (d) { out += d; }); }
		list.on('exit', function () {
			if (myGen !== self.gen) { return; }
			var idx = self._findSinkInputIndex(out, pid);
			if (idx === null) {
				if (retriesLeft > 0) {
					setTimeout(function () { if (myGen === self.gen) { self._applyVolume(retriesLeft - 1); } }, 300);
				} else {
					self.log('_applyVolume: no sink-input found for pid ' + pid + ' (gave up)');
				}
				return;
			}
			try { cp.spawn(PACTL, ['set-sink-input-volume', idx, String(self._volRaw(self.volume))]); }
			catch (e) { self.log('set-sink-input-volume failed: ' + e); }
		});
	},

	_kill: function () {
		this.log('_kill: tearing down (was state=' + this.state + ', gen ' + this.gen + '->' + (this.gen + 1) + ')', true);
		this.gen++; // supersede any in-flight process/callback chain
		this._suspendSink(false); // never leave the output sink suspended across teardown
		this._stopPolling();
		this._stopHeartbeat();
		this._stopFlushTimer();
		this._stopWatchdog();
		this.pendingSegments = [];
		this.pendingBytes = 0;
		if (this.child) {
			this._signal('KILL', this.child.pid);
			// Belt-and-suspenders reap by name too (self.child.pid is
			// gst-launch's own pid directly -- no shell wrapper needed any
			// more now that it reads its own stdin instead of a `< FIFO`
			// redirection -- but this costs nothing and guards against any
			// future reintroduction of a wrapper). Same pattern already
			// proven in packaging/postinst.
			try { cp.spawn('/bin/sh', ['-c', "for p in `ps ax | grep gst-launch | grep -v grep | awk '{print $1}'`; do kill -9 $p; done"]); }
			catch (e) { this.log('gst-launch reap failed: ' + e); }
			this.child = null;
		}
	},

	_fail: function (msg) {
		this.log(msg, true);
		this.state = 'error';
		this.lastError = msg;
		this._kill();
	},

	// ---- gst pipeline setup ------------------------------------------

	// Entry point called from play(). Resolves the playlist once up front to
	// find out whether this is a VOD (archived/completed game, every segment
	// known upfront) or a live (still-growing) broadcast. Both now go through
	// the same incremental relay (_startLiveRelayPipeline): VOD used to be
	// downloaded to one plain file first and played with `filesrc`, but that
	// meant no audio at all until an entire archived game (thousands of
	// segments) had finished downloading. The relay's own _pollOnce already
	// handles a VOD playlist correctly on its own -- it fetches segments in
	// order and stops polling once the (fixed, fully-known) playlist is
	// drained instead of polling forever -- so VOD only differs from live in
	// where it starts: LIVE_EDGE_SEGMENTS back from the end for a live
	// broadcast, VOD_START_SEGMENT_OFFSET in from the start for VOD (see
	// each constant's own comment).
	_startPipeline: function () {
		var self = this;
		var myGen = this.gen;
		self.state = 'downloading';
		self._resolvePlaylist(function () {
			if (myGen !== self.gen) { return; }
			self._curlText(self.variantUrl, function (err, text) {
				if (myGen !== self.gen) { return; }
				if (err) { self._fail('failed to fetch playlist: ' + err); return; }

				var playlist = self._parsePlaylist(text, self.variantUrl);
				self.log('_startPipeline: isVod=' + playlist.isVod + ', ' + playlist.segments.length + ' segment(s) in playlist');
				if (playlist.isVod) {
					// Skip the first VOD_START_SEGMENT_OFFSET segment(s) --
					// see that constant's comment -- by marking them known
					// before the relay's first poll ever sees them.
					var vodStart = Math.min(VOD_START_SEGMENT_OFFSET, playlist.segments.length);
					for (var i = 0; i < vodStart; i++) { self.knownSegments[playlist.segments[i].url] = true; }
				} else {
					// Start near the current live edge, not segment #1 --
					// confirmed live this session that an EVENT playlist
					// lists EVERY segment since the broadcast began, and the
					// start of that recording can be genuine dead air/
					// pre-roll silence (measured -91dB via ffmpeg
					// volumedetect on segments 1-8 of a real broadcast,
					// vs. -26.6dB/-9.5dB on segments from much later in the
					// same playlist -- clearly real audio). Every "silent
					// playback" observation this session was the relay
					// dutifully fetching and playing dead air from the
					// start of the recording, never actually reaching live
					// content in the time any single test ran. Mark
					// everything except the last LIVE_EDGE_SEGMENTS as
					// already-known so the first poll only fetches segments
					// near "now", matching how any real live player joins
					// a broadcast in progress.
					var edgeStart = Math.max(0, playlist.segments.length - LIVE_EDGE_SEGMENTS);
					for (var j = 0; j < edgeStart; j++) { self.knownSegments[playlist.segments[j].url] = true; }
				}
				self._startLiveRelayPipeline();
			});
		});
	},

	// Downloads seg.url to a tmp file, decrypts it in place if seg.keyUri is
	// set (AES-128 HLS encryption -- confirmed live this session that an
	// in-progress game's broadcast was encrypted, unlike every archived/VOD
	// game tested earlier, which is why this was never needed until now),
	// and returns the final plaintext bytes via callback(err, buffer). Used
	// by the relay's _curlSegment for both live and VOD playback.
	_fetchSegmentPlaintext: function (seg, callback, retriesLeft) {
		var self = this;
		if (retriesLeft === undefined) { retriesLeft = 3; }
		var tmpPath = SEGMENT_TMP_PREFIX + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.aac';

		function retryOrFail(err) {
			if (retriesLeft > 0) {
				setTimeout(function () { self._fetchSegmentPlaintext(seg, callback, retriesLeft - 1); }, 300);
			} else {
				callback(err);
			}
		}

		var dl = cp.spawn(CURL, ['-ksSL', seg.url, '-o', tmpPath]);
		var errbuf = '';
		if (dl.stderr) { dl.stderr.on('data', function (d) { errbuf += d; }); }
		dl.on('error', function (e) { retryOrFail('' + e); });
		dl.on('exit', function (code) {
			if (code !== 0) { retryOrFail('curl exit ' + code + ' ' + errbuf + ' url=' + seg.url); return; }

			if (!seg.keyUri) {
				try {
					var data = fs.readFileSync(tmpPath);
					fs.unlinkSync(tmpPath);
					callback(null, data);
				} catch (e) {
					callback('' + e);
				}
				return;
			}

			self._getKeyHex(seg.keyUri, function (keyErr, keyHex) {
				if (keyErr) {
					try { fs.unlinkSync(tmpPath); } catch (e) {}
					callback('key fetch failed: ' + keyErr);
					return;
				}
				var decPath = tmpPath + '.dec';
				self._decryptFile(tmpPath, decPath, keyHex, seg.ivHex, function (decErr) {
					try { fs.unlinkSync(tmpPath); } catch (e) {}
					if (decErr) { callback('decrypt failed: ' + decErr); return; }
					try {
						var plain = fs.readFileSync(decPath);
						fs.unlinkSync(decPath);
						callback(null, plain);
					} catch (e) {
						callback('' + e);
					}
				});
			});
		});
	},

	// AES-128 key fetch, cached by URI (a live playlist's key rarely
	// changes, so this avoids re-fetching it on every poll).
	_getKeyHex: function (keyUri, callback) {
		var self = this;
		if (self.keyCache[keyUri]) { callback(null, self.keyCache[keyUri]); return; }
		var tmpPath = SEGMENT_TMP_PREFIX + 'key-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.bin';
		var dl = cp.spawn(CURL, ['-ksSL', keyUri, '-o', tmpPath]);
		var errbuf = '';
		if (dl.stderr) { dl.stderr.on('data', function (d) { errbuf += d; }); }
		dl.on('error', function (e) { callback('' + e); });
		dl.on('exit', function (code) {
			if (code !== 0) { callback('curl exit ' + code + ' ' + errbuf + ' url=' + keyUri); return; }
			try {
				var data = fs.readFileSync(tmpPath);
				fs.unlinkSync(tmpPath);
				var hex = bufferToHex(data);
				self.keyCache[keyUri] = hex;
				callback(null, hex);
			} catch (e) {
				callback('' + e);
			}
		});
	},

	// AES-128-CBC via openssl (same "shell out to a native binary" pattern
	// as curl -- see file header's /dev/random reasoning for gst's own
	// network fetcher; openssl's own RNG needs are irrelevant here since
	// decryption, unlike a TLS handshake, needs no entropy source at all).
	_decryptFile: function (inPath, outPath, keyHex, ivHex, callback) {
		var p = cp.spawn(OPENSSL, ['enc', '-d', '-aes-128-cbc', '-K', keyHex, '-iv', ivHex, '-in', inPath, '-out', outPath]);
		var errbuf = '';
		if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
		p.on('error', function (e) { callback('' + e); });
		p.on('exit', function (code) {
			if (code !== 0) { callback('openssl exit ' + code + ' ' + errbuf); return; }
			callback(null);
		});
	},

	// ---- relay: fdsrc reading gst-launch's own stdin, fed incrementally as
	// segments are polled/fetched. Used for both live and VOD playback --
	// see _startPipeline's comment.
	_startLiveRelayPipeline: function () {
		var self = this;
		var myGen = this.gen;

		// fdsrc, NOT filesrc -- see file header for the two earlier, more
		// complicated designs this replaced and exactly why each failed.
		// fdsrc fd=0 reads gst-launch's own stdin, which cp.spawn wires up as
		// a real anonymous pipe -- no named FIFO file, no mkfifo (which
		// doesn't even exist on this device), no separate writer process.
		// --gst-debug -- diagnostic only (temporary). GST_STATES:4 surfaces
		// state transitions (NULL->READY->PAUSED->PLAYING) at INFO level.
		// Confirmed live this session that a pipeline can reach real
		// PLAYING state, decode megabytes of valid audio through a genuine
		// AAC chain (id3demux -> aacparse -> ffdec_aac), and STILL never
		// create a PulseAudio sink-input (`pactl list` showed zero, while
		// gst-launch's own process kept accumulating real CPU time) -- no
		// audio ever reaches the speaker despite everything upstream
		// working. The default `*:2` (WARNING) level hides whatever
		// pulsesink/basesink is doing internally when this happens, so
		// pulse*:6, audiosink:6, and basesink:5 are bumped to LOG/INFO to
		// try to catch it actually happening.
		var args = ['--gst-debug=*:2,GST_STATES:4,pulse*:6,audiosink:6,basesink:5', 'fdsrc', 'fd=0', '!', 'decodebin', '!', 'audioconvert', '!', 'pulsesink', 'buffer-time=250000'];
		self.log('spawn: ' + GST + ' ' + args.join(' '));
		self.child = cp.spawn(GST, args);

		if (self.child.stderr) {
			self.child.stderr.on('data', function (d) { self.log('gst stderr: ' + d); });
		}
		self.bytesWrittenToGst = 0;
		if (self.child.stdin) {
			self.child.stdin.on('error', function (e) { self.log('gst stdin error: ' + e); });
			// Diagnostic: confirmed live that gst-launch exits cleanly
			// (code 0) after a small, consistent number of segments even
			// though backpressure never occurs and .end() is never called
			// -- these three events pin down definitively WHICH side (Node
			// vs. gst) is actually ending the stream, and why.
			self.child.stdin.on('close', function () { self.log('gst stdin stream CLOSE event fired'); });
			self.child.stdin.on('end', function () { self.log('gst stdin stream END event fired'); });
			self.child.stdin.on('finish', function () { self.log('gst stdin stream FINISH event fired'); });
		} else {
			self.log('WARNING: gst child has no stdin stream at all');
		}
		self.child.on('error', function (e) {
			if (myGen !== self.gen) { return; }
			self._fail('gst spawn error: ' + e);
		});
		self.child.on('exit', function (code, sig) {
			if (myGen !== self.gen) { return; }
			self.log('gst exit code=' + code + ' sig=' + sig, true);
			self.child = null;
			var wasActive = (self.state === 'playing' || self.state === 'paused');
			// Auto-restart instead of just giving up -- see MAX_RESTART_ATTEMPTS'
			// own comment for why this exists (a known, previously-unrecovered
			// gst quirk) and playlistDrained for the one case where an exit
			// here really is expected (VOD fully consumed, nothing left to feed
			// gst) rather than a crash.
			if (wasActive && !self.playlistDrained && self.restartAttempts < MAX_RESTART_ATTEMPTS) {
				var restartGen = self.gen;
				setTimeout(function () {
					if (restartGen === self.gen) { self._restartPipeline(); }
				}, RESTART_DELAY_MS);
				return;
			}
			if (wasActive) {
				self.state = (code === 0) ? 'ended' : 'error';
				if (code !== 0) { self.lastError = 'gst exit code ' + code; }
				if (wasActive && !self.playlistDrained) {
					self.lastError = 'gst kept exiting unexpectedly after ' + self.restartAttempts + ' restart attempt(s)';
					self.log('giving up after ' + self.restartAttempts + ' restart attempt(s) -- ' + self.lastError, true);
				}
			}
		});

		(function (applyGen) {
			setTimeout(function () { if (applyGen === self.gen) { self._applyVolume(); } }, 300);
		})(self.gen);

		self.pendingSegments = [];
		self.pendingBytes = 0;
		self.state = 'playing';
		self._startPolling();
		self._startHeartbeat();
		self._startFlushTimer();
	},

	// Re-spawns gst only -- NOT a full _kill()/new play(). knownSegments,
	// variantUrl etc. are all left as-is so the relay resumes roughly where
	// it left off (re-polling the same playlist immediately, picking up
	// wherever the live edge or VOD position currently is) instead of
	// restarting the whole broadcast from scratch. See MAX_RESTART_ATTEMPTS'
	// own comment for why this exists.
	_restartPipeline: function () {
		var now = Date.now();
		if (now - this.lastRestartAt > RESTART_ATTEMPT_RESET_MS) {
			this.restartAttempts = 0;
		}
		this.restartAttempts++;
		this.lastRestartAt = now;
		this.log('_restartPipeline: restarting gst (attempt ' + this.restartAttempts + '/' + MAX_RESTART_ATTEMPTS + ')', true);
		this._stopPolling();
		this._stopHeartbeat();
		this._stopFlushTimer();
		this._startLiveRelayPipeline();
	},

	// ---- live playlist relay -------------------------------------------

	// Resolves the app-provided URL to a media (variant) playlist if it's a
	// master playlist, then starts polling it. MLB's radio broadcasts seen
	// this session are single-variant masters, so this just follows the
	// first #EXT-X-STREAM-INF entry.
	_resolvePlaylist: function (callback) {
		var self = this;
		var myGen = this.gen;
		self.log('_resolvePlaylist: fetching ' + this.url);
		this._curlText(this.url, function (err, text) {
			if (myGen !== self.gen) { return; }
			if (err) { self._fail('failed to fetch playback URL: ' + err); return; }
			self.log('_resolvePlaylist: got ' + (text ? text.length : 0) + ' bytes');

			if (text.indexOf('#EXT-X-STREAM-INF') !== -1) {
				var lines = text.split('\n').map(function (l) { return l.replace(/\r$/, ''); });
				var variantPath = null;
				for (var i = 0; i < lines.length; i++) {
					if (lines[i].indexOf('#EXT-X-STREAM-INF') === 0) {
						variantPath = lines[i + 1];
						break;
					}
				}
				if (!variantPath) { self._fail('master playlist had no variant entry'); return; }
				self.variantUrl = self._resolveUrl(variantPath, self.url);
				self.log('_resolvePlaylist: master playlist -> variant ' + self.variantUrl);
			} else {
				self.variantUrl = self.url; // already a media playlist
				self.log('_resolvePlaylist: already a media playlist, using as-is');
			}
			callback();
		});
	},

	// Minimal same-directory relative URL resolution (every playlist/segment
	// path seen live this session was a simple relative path, no "../").
	_resolveUrl: function (maybeRelative, baseUrl) {
		if (/^https?:\/\//i.test(maybeRelative)) { return maybeRelative; }
		var lastSlash = baseUrl.lastIndexOf('/');
		return baseUrl.slice(0, lastSlash + 1) + maybeRelative;
	},

	// Parses a media playlist into {isVod, targetDuration, segments}, where
	// each segment is {url, keyUri, ivHex} -- keyUri/ivHex are null unless
	// an #EXT-X-KEY:METHOD=AES-128 applies (confirmed live this session
	// that in-progress games are encrypted, unlike every VOD/archived game
	// tested earlier). A #EXT-X-KEY applies to every segment after it until
	// the next one, per the HLS spec, so key/IV state is tracked as the
	// lines are walked in order rather than looked up independently per
	// segment. When a key has no explicit IV=, the spec's fallback is the
	// segment's own media sequence number as a 128-bit big-endian value.
	_parsePlaylist: function (text, baseUrl) {
		var self = this;
		var isVod = text.indexOf('#EXT-X-PLAYLIST-TYPE:VOD') !== -1;
		var targetDurationMatch = text.match(/#EXT-X-TARGETDURATION:(\d+)/);
		var seqMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
		var seq = seqMatch ? parseInt(seqMatch[1], 10) : 0;

		var lines = text.split('\n').map(function (l) { return l.replace(/\r$/, ''); }).filter(function (l) { return l.length; });
		var segments = [];
		var curMethod = 'NONE';
		var curKeyUri = null;
		var curIvHex = null;

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];
			if (line.indexOf('#EXT-X-KEY') === 0) {
				var methodMatch = line.match(/METHOD=([^,]+)/);
				curMethod = methodMatch ? methodMatch[1] : 'NONE';
				if (curMethod === 'NONE') {
					curKeyUri = null;
					curIvHex = null;
				} else {
					var uriMatch = line.match(/URI="([^"]+)"/);
					curKeyUri = uriMatch ? self._resolveUrl(uriMatch[1], baseUrl) : null;
					var ivMatch = line.match(/IV=0[xX]([0-9A-Fa-f]+)/);
					curIvHex = ivMatch ? ivMatch[1] : null;
				}
			} else if (line.charAt(0) !== '#') {
				var encrypted = curMethod === 'AES-128';
				segments.push({
					url: self._resolveUrl(line, baseUrl),
					keyUri: encrypted ? curKeyUri : null,
					ivHex: encrypted ? (curIvHex || self._seqToIvHex(seq)) : null
				});
				seq++;
			}
		}

		return {
			isVod: isVod,
			targetDuration: targetDurationMatch ? parseInt(targetDurationMatch[1], 10) : null,
			segments: segments
		};
	},

	_seqToIvHex: function (seq) {
		var hex = seq.toString(16);
		while (hex.length < 32) { hex = '0' + hex; }
		return hex;
	},

	_curlText: function (url, callback) {
		var out = '', err = '';
		// --compressed: confirmed live this session that MLB's playlist
		// responses are gzip-compressed and, without this flag, curl
		// returned the raw compressed bytes as-is -- which every downstream
		// consumer (indexOf('#EXT-X-STREAM-INF'), split('\n'), the
		// #EXT-X-TARGETDURATION regex) silently misparsed as a 1-line,
		// non-master, non-VOD "playlist" instead of erroring outright. That
		// was the actual root cause of "NowPlaying but no audio" -- the
		// relay was polling a playlist it could never read.
		var p = cp.spawn(CURL, ['-ksSL', '--compressed', url]);
		if (p.stdout) { p.stdout.on('data', function (d) { out += d; }); }
		if (p.stderr) { p.stderr.on('data', function (d) { err += d; }); }
		p.on('error', function (e) { callback('' + e); });
		p.on('exit', function (code) {
			if (code !== 0) { callback('curl exit ' + code + ' ' + err); return; }
			callback(null, out);
		});
	},

	_startPolling: function () {
		var self = this;
		if (!this.variantUrl) {
			this._resolvePlaylist(function () { self._pollOnce(); });
			return;
		}
		this._pollOnce();
	},

	_pollOnce: function () {
		var self = this;
		var myGen = this.gen;
		if (this.state !== 'playing' && this.state !== 'paused') {
			self.log('_pollOnce: skipped, state=' + this.state);
			return;
		}
		self.log('_pollOnce: fetching ' + this.variantUrl);

		this._curlText(this.variantUrl, function (err, text) {
			if (myGen !== self.gen) { return; }
			if (err) {
				self.log('playlist poll failed: ' + err);
				self._schedulePoll();
				return;
			}

			var playlist = self._parsePlaylist(text, self.variantUrl);

			var newSegments = [];
			for (var i = 0; i < playlist.segments.length; i++) {
				var seg = playlist.segments[i];
				if (!self.knownSegments[seg.url]) {
					self.knownSegments[seg.url] = true;
					newSegments.push(seg);
				}
			}

			self.log('_pollOnce: got ' + text.length + ' bytes, isVod=' + playlist.isVod
				+ ', targetDuration=' + (playlist.targetDuration || 'none')
				+ ', totalSegmentsInPlaylist=' + playlist.segments.length
				+ ', newSegments=' + newSegments.length);

			self._fetchSegmentsInOrder(newSegments, function () {
				if (myGen !== self.gen) { return; }
				// A VOD playlist (archived/completed game) lists every segment
				// upfront -- once they're all fetched there's nothing left to
				// poll for, so stop instead of hitting the same URL forever.
				// A live playlist keeps growing, so keep polling.
				if (playlist.isVod && newSegments.length === 0) {
					self.log('VOD playlist fully drained, stopping poll');
					// See _restartPipeline's own comment -- an unexpected
					// gst exit from here on is real completion (nothing
					// left to feed it), not a crash worth restarting from.
					self.playlistDrained = true;
					return;
				}
				// Capped at 15s regardless of what the playlist's own
				// #EXT-X-TARGETDURATION claims -- that field's spec meaning
				// is "max duration of any one segment", not "how often to
				// re-poll", and trusting it directly for scheduling risked
				// an unreasonably long real-world delay if a VOD/archived
				// playlist ever reports an unusual value here.
				var rawDelay = playlist.targetDuration ? playlist.targetDuration * 1000 : DEFAULT_POLL_INTERVAL_MS;
				var delay = Math.min(rawDelay, 15000);
				self.log('_pollOnce: scheduling next poll in ' + delay + 'ms (raw=' + rawDelay + 'ms)');
				self._schedulePoll(delay);
			});
		});
	},

	_schedulePoll: function (delay) {
		var self = this;
		var myGen = this.gen;
		this.pollTimer = setTimeout(function () {
			if (myGen === self.gen) { self._pollOnce(); }
		}, delay || DEFAULT_POLL_INTERVAL_MS);
	},

	_stopPolling: function () {
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
	},

	// Fetches segments strictly in order (never in parallel -- order matters
	// for a continuous audio stream), feeding each into the FIFO as it
	// arrives before starting the next.
	_fetchSegmentsInOrder: function (segments, done) {
		var self = this;
		var myGen = this.gen;
		var i = 0;

		self.log('_fetchSegmentsInOrder: starting, ' + segments.length + ' segment(s) to fetch');
		function next() {
			if (myGen !== self.gen) { self.log('_fetchSegmentsInOrder: aborted, generation changed'); return; }
			if (i >= segments.length) { self.log('_fetchSegmentsInOrder: done, fetched ' + i + ' segment(s)'); done(); return; }
			var seg = segments[i++];
			self._curlSegment(seg, function (err) {
				if (err) { self.log('segment fetch failed (' + i + '/' + segments.length + '): ' + err); }
				next();
			});
		}
		next();
	},

	// Fetches (and decrypts, if needed) one segment via the shared
	// _fetchSegmentPlaintext helper, then buffers the plaintext bytes for
	// _flushPendingSegments rather than writing straight to gst's stdin --
	// see that function's comment for why: this old Node's child_process
	// stdin closes itself after very few .write() calls, confirmed live,
	// so writes are batched instead of one per segment.
	_curlSegment: function (seg, callback) {
		var self = this;
		self._fetchSegmentPlaintext(seg, function (err, data) {
			if (err) { callback(err); return; }
			if (!self.child || !self.child.stdin) {
				callback('gst process not available to write to (stopped mid-fetch?)');
				return;
			}
			self.pendingSegments.push(data);
			self.pendingBytes += data.length;
			self.log('buffered segment: ' + data.length + ' bytes (pending total ' + self.pendingBytes + ')');
			if (self.pendingBytes >= MAX_PENDING_BYTES) {
				self.log('pending buffer at cap (' + self.pendingBytes + ' bytes), flushing early');
				self._flushPendingSegments();
			}
			callback(null);
		});
	},

	// ---- batched write to gst's stdin -----------------------------------
	//
	// See _curlSegment's comment for why this exists at all: this old
	// Node's child_process stdin closes itself after exactly 5 .write()
	// calls, confirmed live and reproducible. Fetched segments are buffered
	// in pendingSegments/pendingBytes and flushed as ONE combined
	// .write() call on a timer (FLUSH_INTERVAL_MS) or early if
	// MAX_PENDING_BYTES is reached -- this keeps the total .write() call
	// count low across an entire playback session instead of one per
	// ~4-second segment.

	_startFlushTimer: function () {
		var self = this;
		var myGen = this.gen;
		this._stopFlushTimer();
		this.flushTimer = setTimeout(function () {
			if (myGen !== self.gen) { return; }
			self._flushPendingSegments();
			self._startFlushTimer();
		}, FLUSH_INTERVAL_MS);
	},

	_stopFlushTimer: function () {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	},

	_flushPendingSegments: function () {
		if (!this.pendingSegments.length) { return; }
		if (!this.child || !this.child.stdin) {
			this.log('_flushPendingSegments: no gst stdin to write to, dropping ' + this.pendingSegments.length + ' buffered segment(s)');
			this.pendingSegments = [];
			this.pendingBytes = 0;
			return;
		}
		var combined = concatBuffers(this.pendingSegments);
		var count = this.pendingSegments.length;
		this.pendingSegments = [];
		this.pendingBytes = 0;
		this.bytesWrittenToGst = (this.bytesWrittenToGst || 0) + combined.length;
		this.log('flushing ' + count + ' buffered segment(s) to gst stdin in one write: ' + combined.length + ' bytes (total ' + this.bytesWrittenToGst + ')');
		try {
			this.child.stdin.write(combined);
		} catch (e) {
			this.log('flush write failed: ' + e);
		}
	},

	// ---- heartbeat -------------------------------------------------------

	_startHeartbeat: function () {
		if (!this.heartbeatUrl) { return; }
		this._pingHeartbeat();
	},

	_pingHeartbeat: function () {
		var self = this;
		var myGen = this.gen;
		if (this.state !== 'playing' && this.state !== 'paused') { return; }
		try { cp.spawn(CURL, ['-ksSL', '-X', 'POST', this.heartbeatUrl]); }
		catch (e) { this.log('heartbeat ping failed: ' + e); }
		this.heartbeatTimer = setTimeout(function () {
			if (myGen === self.gen) { self._pingHeartbeat(); }
		}, Math.max(5, this.heartbeatInterval) * 1000);
	},

	_stopHeartbeat: function () {
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	},

	// ---- watchdog ----------------------------------------------------------
	//
	// This service is a separate long-running process from the app's own UI
	// (see file header) -- it has no built-in way to know the app is gone.
	// The app originally told it explicitly via an onUnload hook when its
	// card was tossed away, but that turned out not to fire reliably on this
	// device/webOS version (confirmed live: tossing the card while playing
	// left the service running with real audio still coming out). Detecting
	// "app is gone" from THIS side instead sidesteps needing that event at
	// all: every app-originated command (the 1s getStatus poll while
	// playing/paused, but also play/pause/resume/stop/setVolume, all of
	// which return status()) bumps lastStatusPollAt, so as long as the app
	// is alive it keeps this fresh on its own; once it stops (tossed,
	// crashed, killed, anything), the periodic check below notices the gap
	// and stops playback itself.

	_startWatchdog: function () {
		this._stopWatchdog();
		this.lastStatusPollAt = Date.now();
		var self = this;
		this.watchdogTimer = setInterval(function () { self._watchdogCheck(); }, WATCHDOG_INTERVAL_MS);
	},

	_stopWatchdog: function () {
		if (this.watchdogTimer) {
			clearInterval(this.watchdogTimer);
			this.watchdogTimer = null;
		}
	},

	_watchdogCheck: function () {
		if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'downloading') { return; }
		if (Date.now() - this.lastStatusPollAt > WATCHDOG_TIMEOUT_MS) {
			this.log('_watchdogCheck: no status() call in ' + WATCHDOG_TIMEOUT_MS + 'ms, assuming app is gone -- stopping playback', true);
			this.stop();
		}
	},

	// ---- public commands -------------------------------------------------

	// args: { url, heartbeatUrl, heartbeatInterval } -- url is the app's
	// already-authenticated playback URL from initPlaybackSession (master or
	// media playlist, either works, see _resolvePlaylist).
	play: function (args) {
		args = args || {};
		if (!args.url) {
			this.state = 'error';
			this.lastError = 'play: no url given';
			return this.status();
		}

		if (args.url === this.url && this.state === 'paused' && this.child) {
			this.log('play: resuming existing session, url=' + args.url, true);
			return this.resume();
		}

		this.log('play: starting new session, url=' + args.url, true);
		this._kill();
		this.url = args.url;
		this.variantUrl = '';
		this.heartbeatUrl = args.heartbeatUrl || '';
		this.heartbeatInterval = args.heartbeatInterval || 60;
		this.knownSegments = {};
		this.lastError = '';
		this.playlistDrained = false;
		this.restartAttempts = 0;
		this.lastRestartAt = 0;
		this._startPipeline();
		this._startWatchdog();
		return this.status();
	},

	pause: function () {
		if (this.child && this.state === 'playing') {
			this._suspendSink(true); // freeze the audio device (the actual pause)
			this._signal('STOP');    // and freeze gst so it doesn't decode ahead
			this.state = 'paused';
		}
		return this.status();
	},

	resume: function () {
		if (this.child && this.state === 'paused') {
			this._suspendSink(false);
			this._signal('CONT');
			this.state = 'playing';
		}
		return this.status();
	},

	stop: function () {
		this.log('stop: explicit stop() call received', true);
		this._kill();
		this.state = 'idle';
		this.url = '';
		this.variantUrl = '';
		return this.status();
	},

	setVolume: function (pct) {
		this.volume = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
		this._applyVolume(); // no-op if nothing is playing right now; re-applied on next spawn
		return this.status();
	},

	getVolume: function () {
		return { returnValue: true, volume: this.volume };
	},

	status: function () {
		this.lastStatusPollAt = Date.now(); // see _watchdogCheck
		return {
			returnValue: true,
			state: this.state,
			isPlaying: this.state === 'playing',
			url: this.url,
			volume: this.volume,
			error: this.lastError
		};
	}
};

// ---------------------------------------------------------------------------
// httpRequest: a generic curl-backed HTTPS proxy, unrelated to playback.
//
// WHY THIS EXISTS: MLB's Okta login (ROPC/password grant) actively refuses
// requests that look like they came from a browser -- confirmed live this
// session: the exact same request succeeds from a plain Node.js script (no
// browser Origin/Referer headers) but fails from this app's own WebKit
// networking with a real Okta error, `error=unauthorized_client,
// error_description=Browser requests to the token endpoint may only use
// the authorization_code grant_type.` This isn't a bug to fix in the
// request itself -- Okta is deliberately blocking ROPC from browser-like
// clients as a security policy, and no header tweak on the app side can
// get around a security policy that's specifically detecting "is this a
// browser" (almost certainly via Origin/Referer, which a WebKit XHR always
// sends and a bare curl process never does).
//
// The fix is architectural: route this call (and, since it's the same
// trust boundary and was never independently verified from a real device
// context either, the MLB GraphQL media-gateway calls too) through this
// service's curl, which doesn't look like a browser to begin with -- the
// same reasoning already applied to HLS segment fetching (see file header
// and the /dev/random note below). The app (lib/OktaAuth.js,
// lib/MLBMediaGateway.js) still owns building the request body/headers and
// parsing the response; this command is a thin, MLB-agnostic transport,
// not business logic -- keeps the "no OAuth/GraphQL logic in the service"
// intent from the project's Sub-phase A architecture refinement mostly
// intact, just narrowed to "no INTERPRETATION of OAuth/GraphQL", since the
// transport itself has to live here now.
//
// Uses curl for the same /dev/random reason as segment fetching (this
// service's jail has no /dev/random; gst/Node's own HTTPS stacks abort on
// TLS init there, curl's OpenSSL doesn't need it).
//
// args: { url, method (default POST), headers (object), body (string) }
// result: { returnValue: true, status: <int>, json: <parsed object or
// null>, raw: <string, only present if json parsing failed> } or
// { returnValue: false, error: <string> } if curl itself couldn't run.
//
// Body/header values are passed as literal argv elements to a directly
// spawned curl process (cp.spawn with an args array, no /bin/sh -c
// involved) -- unlike this file's other shell-based helpers, there is no
// shell interpretation here at all, so arbitrary characters in a user's
// password can't be interpreted as shell syntax.
function httpRequest(args, callback) {
	args = args || {};
	if (!args.url) {
		callback({ returnValue: false, error: 'httpRequest: no url given', echo: args.echo });
		return;
	}

	// --compressed defensively -- see _curlText's comment for why this
	// matters: a gzip-compressed response silently misparses as garbage
	// rather than erroring, which is a much worse failure mode than just
	// adding this unconditionally (a no-op against an uncompressed reply).
	var curlArgs = ['-ksS', '--compressed', '-X', (args.method || 'POST'), '-w', '\n%{http_code}'];
	// Opt-in only (views/ArticleReaderView.js sets this for article-page
	// GETs, e.g. old-style espn.com/mlb/recap?gameId=... links that 301 to
	// their real URL -- confirmed live, see mlbatbat_espn_akamai_block-
	// adjacent ArticleReader logging) -- deliberately NOT the default for
	// every caller of this shared command: curl's -L on a redirected POST
	// silently downgrades to a GET past the redirect (no --post301/302/303
	// here), which isn't a behavior change worth risking on the Okta login/
	// GraphQL POST calls this same command also serves, for a problem that
	// GET requests are actually the ones with here.
	if (args.followRedirects) {
		curlArgs.push('-L');
	}
	var headers = args.headers || {};
	for (var k in headers) {
		curlArgs.push('-H', k + ': ' + headers[k]);
	}
	if (args.body !== undefined && args.body !== null) {
		curlArgs.push('--data-binary', args.body);
	}
	curlArgs.push(args.url);

	var out = '', errbuf = '';
	var p = cp.spawn(CURL, curlArgs);
	if (p.stdout) { p.stdout.on('data', function (d) { out += d; }); }
	if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
	p.on('error', function (e) {
		callback({ returnValue: false, error: 'curl spawn error: ' + e, echo: args.echo });
	});
	p.on('exit', function (code) {
		// See absDebugLog's own comment (getAbsChallengeEvents) -- cheap
		// enough to leave on unconditionally for every httpRequest caller,
		// not just the ABS path, and useful generically for exactly this
		// class of "did the service even get this far" question.
		absDebugLog('httpRequest curl exit code=' + code + ' outLen=' + out.length + ' url=' + args.url);
		if (code !== 0) {
			callback({ returnValue: false, error: 'curl exit ' + code + ' ' + errbuf, echo: args.echo });
			return;
		}
		var idx = out.lastIndexOf('\n');
		var status = idx >= 0 ? parseInt(out.slice(idx + 1), 10) : 0;
		var bodyText = idx >= 0 ? out.slice(0, idx) : out;
		var json = null;
		try { json = JSON.parse(bodyText); } catch (e) { json = null; }
		callback({
			returnValue: true,
			status: status,
			json: json,
			raw: json ? undefined : bodyText,
			// Passed straight through from args.echo if the caller set it --
			// lets a caller that fires several overlapping httpRequest calls
			// (e.g. views/AbsStatsView.js switching games quickly) match a
			// response back to the request that produced it instead of
			// trusting call order, which async curl completion doesn't
			// guarantee. undefined/no-op for every caller that doesn't set it.
			echo: args.echo
		});
	});
}

// ---------------------------------------------------------------------------
// getAbsChallengeEvents: fetches Baseball Savant's per-game feed
// (baseballsavant.mlb.com/gf?game_pk=...) and extracts just the ABS
// (Automated Ball-Strike) challenge events out of it -- a few-hundred-KB to
// multi-MB full Statcast pitch-by-pitch payload, with challenge events
// buried one-per-pitch inside every batter's own pitch array
// (home_batters/away_batters, keyed by player id), each a hundred-plus-
// field record (pitch physics, rolling aggregate stats, etc.) almost all
// irrelevant to just "what got challenged and what happened".
//
// CANNOT use JSON.parse() on the response as a whole, and CANNOT fetch it
// the way httpRequest's own curl helper does (accumulating stdout 'data'
// chunks via repeated `out += d`) either -- confirmed live (2026-08-07, via
// novacom + luna-send + file-based absDebugLog, since a service crash
// takes out the very LS2 response channel that would otherwise report it)
// that this device's Luna service Node runtime is v0.4.12 (~2011-era), and
// the real problem is V8 string ROPES: repeated `+=` concatenation across
// dozens of stdout chunks builds a ConsString, not a flat string --
// `.length` reads fine off a rope, but the FIRST operation requiring flat
// character access (even a plain `.lastIndexOf()`, not just JSON.parse or
// `.slice()`) forces V8 to flatten/materialize the whole ~2.3MB+ thing
// into one contiguous buffer, and THAT flatten is what exceeds this
// device's heap -- not the data's size by itself (fs.readFileSync of the
// exact same file-sized payload works fine, since it returns an
// already-flat string with no rope to flatten). See curlToFileAndRead
// above: writes the response to a temp file via curl's own -o instead of
// capturing stdout, then a single fs.readFileSync for a clean flat string
// -- sidesteps the rope entirely. That crash was what the app was seeing
// as a generic native "Message status unknown" PalmServiceBridge error --
// not a timeout, the service was dying mid-request.
//
// Instead: scan the raw TEXT for "is_abs_challenge":true occurrences (a
// small, known-fixed string, cheap to search for even across a multi-MB
// string), then for each match, string-aware-brace-match outward to find
// just that ONE pitch record's own self-contained {...} JSON object and
// JSON.parse() ONLY that small (~1-5KB) fragment. The full multi-MB object
// graph is never built in memory at any point -- peak additional memory
// for this whole function is one full response string plus a handful of
// small parsed fragments.
//
// This key is confirmed to appear in more than one place in the response
// (batters AND pitchers AND team-level rollups all reference the same
// underlying pitch data) -- results are deduplicated by rowId (falling
// back to play_id) since the same challenge would otherwise be double or
// triple counted.
//
// args: { gamePk }
// result: { returnValue: true, challenges: [ {ab_number, inning,
// half_inning, outs, batter_name, pitcher_name, team_batting,
// team_fielding, des, call_name, pitch_name, plate_x, plate_z, sz_top,
// sz_bot, is_overturned, edge_distance, challenging_player_type}, ... ]
// (sorted into game order by ab_number) } or { returnValue: false, error }.
// TEMP DEBUG: writes directly to a file, independent of whatever response
// channel (LS2/PalmServiceBridge) might itself be failing -- exactly the
// case being debugged here, so logging that only reaches the app via that
// same channel would tell us nothing if the process dies before responding.
// Remove once getAbsChallengeEvents is confirmed reliable on-device.
function absDebugLog(msg) {
	try {
		// This Node build (v0.4.12, confirmed live) has no
		// fs.appendFileSync at all -- only fs.writeFileSync. Read-then-
		// rewrite instead; fine for a low-volume debug log like this one.
		var line = '[' + new Date().toISOString() + '] ' + msg + '\n';
		var existing = '';
		try { existing = fs.readFileSync('/tmp/abs_debug.log', 'utf8'); } catch (e) { /* first write */ }
		fs.writeFileSync('/tmp/abs_debug.log', existing + line);
	} catch (e) { /* never let logging itself break anything */ }
}

// Fetches a URL to a TEMP FILE (curl's own -o) and reads it back via a
// single fs.readFileSync, instead of accumulating curl's stdout via
// repeated `+=` the way httpRequest's own curl helper does.
//
// This distinction is the actual fix for getAbsChallengeEvents' crash --
// confirmed live via bisection (file-based absDebugLog calls placed around
// each step, since the crash itself takes out the very LS2 response
// channel that would otherwise report anything): building `out` via many
// `out += d` appends across dozens of stdout 'data' chunks produces a V8
// "rope"/ConsString, not a flat string -- outLen (.length) alone reads
// fine off a rope, but the FIRST operation that actually requires flat
// character access (confirmed: even a plain .lastIndexOf('\n') call, not
// just the .slice() originally suspected) forces V8 to flatten/materialize
// the whole thing into one contiguous buffer, and THAT is what exceeds
// this device's heap for a ~2.3MB response -- not the string's size by
// itself (fs.readFileSync of the exact same ~2.3MB file, confirmed
// separately via novacom, works fine, because it returns an already-flat
// string with no rope to flatten). Writing to a file and reading it back
// sidesteps the rope entirely.
function curlToFileAndRead(url, tmpPath, callback) {
	// --max-time 30 -- added specifically for downloadEspnVideoHls's own
	// playlist fetches (this function's other, older caller,
	// getAbsChallengeEvents, has never shown a need for this, but a
	// bounded timeout is harmless there too: it doesn't change behavior
	// for any request that completes normally, only guarantees one that
	// genuinely hangs eventually fails instead of stalling forever with
	// zero recovery -- a real gap confirmed live 2026-08-09, a stuck
	// download with no timeout and no way to tell hang from slow).
	var curlArgs = ['-ksS', '--max-time', '30', '--compressed', '-X', 'GET', '-o', tmpPath, '-w', '%{http_code}', url];
	var statusOut = '', errbuf = '';
	var p = cp.spawn(CURL, curlArgs);
	// statusOut is just the -w output (a handful of digits, e.g. "200"),
	// NOT the response body -- that goes straight to tmpPath via -o.
	// Trivial size, no rope-flatten risk here.
	if (p.stdout) { p.stdout.on('data', function (d) { statusOut += d; }); }
	if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
	p.on('error', function (e) {
		callback({ returnValue: false, error: 'curlToFileAndRead: curl spawn error: ' + e });
	});
	p.on('exit', function (code) {
		absDebugLog('curlToFileAndRead exit code=' + code + ' statusOut=' + statusOut + ' url=' + url);
		if (code !== 0) {
			callback({ returnValue: false, error: 'curlToFileAndRead: curl exit ' + code + ' ' + errbuf });
			return;
		}
		var status = parseInt(statusOut, 10) || 0;
		var text;
		try {
			text = fs.readFileSync(tmpPath, 'utf8');
		} catch (e) {
			callback({ returnValue: false, error: 'curlToFileAndRead: readFileSync failed: ' + e });
			return;
		}
		try { fs.unlinkSync(tmpPath); } catch (e) { /* not fatal -- next call reuses/overwrites tmpPath anyway */ }
		absDebugLog('curlToFileAndRead read back ' + text.length + ' chars from ' + tmpPath);
		callback({ returnValue: true, status: status, raw: text });
	});
}

function getAbsChallengeEvents(args, callback) {
	args = args || {};
	if (!args.gamePk) {
		callback({ returnValue: false, error: 'getAbsChallengeEvents: no gamePk given' });
		return;
	}
	absDebugLog('start gamePk=' + args.gamePk);
	var url = 'https://baseballsavant.mlb.com/gf?game_pk=' + encodeURIComponent(args.gamePk);
	// Unique per-call tmp path (was a single fixed '/tmp/mlbatbat_abs_gf.tmp'
	// shared by every call) -- if two calls to this command ever overlap
	// (e.g. the app fires a second game's request before the first one's
	// curlToFileAndRead has finished reading/unlinking its file), both curl
	// processes were writing to and unlinking the SAME path, so one call's
	// cleanup could delete or truncate the file out from under the other's
	// still-in-flight read. Never observed a clean overlap in on-device logs
	// yet, but it's a real race regardless -- cheap to close off entirely.
	var tmpPath = '/tmp/mlbatbat_abs_gf-' + args.gamePk + '-' + Date.now() + '.tmp';
	curlToFileAndRead(url, tmpPath, function (result) {
		absDebugLog('entered getAbsChallengeEvents callback: returnValue=' + result.returnValue +
			' status=' + result.status + ' rawLen=' + (result.raw ? result.raw.length : -1));
		if (!result.returnValue) {
			absDebugLog('curlToFileAndRead failed: ' + JSON.stringify(result).substring(0, 300));
			result.gamePk = args.gamePk;
			callback(result);
			return;
		}
		var text = result.raw;
		if (!text) {
			absDebugLog('empty raw text');
			callback({ returnValue: false, error: 'getAbsChallengeEvents: empty gf response', gamePk: args.gamePk });
			return;
		}

		var pitchObjects;
		try {
			absDebugLog('starting extraction, textLen=' + text.length);
			pitchObjects = extractChallengePitchObjects(text);
			absDebugLog('extraction done, found ' + pitchObjects.length + ' raw matches');
		} catch (e) {
			absDebugLog('extraction threw: ' + (e && e.stack ? e.stack : e));
			callback({ returnValue: false, error: 'getAbsChallengeEvents: extraction threw: ' + e, gamePk: args.gamePk });
			return;
		}

		var seen = {};
		var challenges = [];
		for (var i = 0; i < pitchObjects.length; i++) {
			var pitch = pitchObjects[i];
			if (!pitch || !pitch.abs_challenge) { continue; }
			var dedupeKey = pitch.rowId || pitch.play_id;
			if (dedupeKey) {
				if (seen[dedupeKey]) { continue; }
				seen[dedupeKey] = true;
			}
			var ac = pitch.abs_challenge;
			challenges.push({
				ab_number: pitch.ab_number,
				inning: pitch.inning,
				half_inning: pitch.half_inning,
				outs: pitch.outs,
				batter_name: pitch.batter_name,
				pitcher_name: pitch.pitcher_name,
				catcher_name: pitch.catcher_name,
				team_batting: pitch.team_batting,
				team_fielding: pitch.team_fielding,
				des: pitch.des,
				call_name: pitch.call_name,
				pitch_name: pitch.pitch_name,
				// Count AFTER this pitch -- views/AbsStatsView.js builds its
				// own "Count is now X-Y" sentence from these rather than
				// using `des`'s free-text description.
				balls: pitch.balls,
				strikes: pitch.strikes,
				// Pitch-location fields for views/AbsStatsView.js's plate-view
				// diagram -- plate_x/plate_z are the pitch's actual crossing
				// point (feet, plate_x=0 is the plate's center), sz_top/sz_bot
				// are THIS BATTER's own strike zone bounds (feet) for that
				// at-bat.
				plate_x: pitch.plate_x,
				plate_z: pitch.plate_z,
				sz_top: pitch.sz_top,
				sz_bot: pitch.sz_bot,
				is_overturned: !!ac.is_overturned,
				edge_distance: ac.edge_distance,
				challenging_player_type: ac.challenging_player_type
			});
		}
		challenges.sort(function (a, b) { return (a.ab_number || 0) - (b.ab_number || 0); });
		absDebugLog('deduped to ' + challenges.length + ' challenges, about to callback');
		callback({ returnValue: true, challenges: challenges, gamePk: args.gamePk });
		absDebugLog('callback returned');
	});
}

// Finds every self-contained {...} object in `text` whose own top-level
// keys include "is_abs_challenge":true, and JSON.parse()s just those
// fragments. See getAbsChallengeEvents' own header comment for why this
// exists instead of JSON.parse(text) once.
function extractChallengePitchObjects(text) {
	var marker = '"is_abs_challenge":true';
	var results = [];
	var searchFrom = 0;
	var idx;
	while ((idx = text.indexOf(marker, searchFrom)) !== -1) {
		searchFrom = idx + marker.length;
		var start = findEnclosingBraceBackward(text, idx - 1);
		if (start === -1) { continue; }
		var end = findMatchingBraceForward(text, start);
		if (end === -1) { continue; }
		var fragment = text.substring(start, end + 1);
		try {
			results.push(JSON.parse(fragment));
		} catch (e) {
			// Malformed/unexpected fragment -- skip just this one match
			// rather than failing the whole extraction.
		}
	}
	return results;
}

// Scans backward from `pos` for the "{" that opens the object containing
// position pos+1 -- string-aware (ignores brace-like characters that are
// actually inside a JSON string value, e.g. within a "des" description).
function findEnclosingBraceBackward(text, pos) {
	var depth = 0;
	var inString = false;
	for (var i = pos; i >= 0; i--) {
		var c = text.charAt(i);
		if (inString) {
			if (c === '"' && text.charAt(i - 1) !== '\\') {
				inString = false;
			}
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === '}') {
			depth++;
		} else if (c === '{') {
			if (depth === 0) {
				return i;
			}
			depth--;
		}
	}
	return -1;
}

// Scans forward from `start` (the position of an opening "{") for its own
// matching closing "}" -- same string-awareness as the backward scan above.
function findMatchingBraceForward(text, start) {
	var depth = 0;
	var inString = false;
	for (var i = start; i < text.length; i++) {
		var c = text.charAt(i);
		if (inString) {
			if (c === '"' && text.charAt(i - 1) !== '\\') {
				inString = false;
			}
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
			if (depth === 0) {
				return i;
			}
		}
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Video highlight download+play PROOF OF CONCEPT (views/VideosView.js).
//
// ESPN's own clip-detail API (content.core.api.espn.com/v1/video/clips/{id},
// fetched app-side via the generic httpRequest command above) already hands
// back a DIRECT, unauthenticated, non-expiring progressive MP4 URL on
// espnmedia-cdn.akamaized.net -- confirmed live (2026-08-08): 200 OK,
// video/mp4, Cache-Control good for ~a month, no signed token/query param.
// Unlike Dailymotion (see the sibling `dailymotion` project's metube.md --
// confirmed dead two different ways there: no public unauthenticated CDN
// URL exists at all), ESPN never needs real yt-dlp-style extraction, so
// this doesn't need the third-party metube.webosarchive.org service:
// this service's own curl (already proven able to reach modern-TLS HTTPS
// endpoints server-side, e.g. httpRequest's own News-Akamai-bypass use)
// just downloads the file directly.
//
// The device's own media pipeline (GStreamer) still can't negotiate modern
// TLS itself (same root cause as Dailymotion's playback failure, per that
// project's own README) -- that's why this can't just hand the device the
// espncdn.akamaized.net URL directly and call it done. Downloading
// server-side first sidesteps that; how the downloaded file gets handed
// BACK to the device went through two attempts:
//
//   1. file:// straight to the downloaded path -- launched the system
//      video player, which showed its spinner then failed with "there was
//      an error playing the file" (confirmed live, 2026-08-08). Whatever
//      the exact cause (permissions, or this player simply not trusting
//      file:// targets for real decode), it doesn't work.
//   2. A small local HTTP static-file server (startVideoHttpServer below),
//      serving the SAME downloaded file over plain http://127.0.0.1 --
//      per direct user steer ("I think the metube approach is tried and
//      true... maybe try that"): this is exactly what MeTube/the sibling
//      dailymotion project's metube.webosarchive.org already does (serve
//      the finished download back over plain HTTP, never hand the device
//      a TLS or filesystem path to negotiate itself), just self-hosted on
//      this device instead of a remote server -- there's no need for a
//      remote server here at all, since the ESPN URL was already
//      unauthenticated and this service can already reach it directly.
//
// /media/internal/, NOT /tmp/ -- /tmp is tmpfs, capped at ~40MB in this
// jail (see this project's own webos_jail_tmpfs_leaked_fd finding),
// nowhere near enough for a real clip (one 52-second highlight was
// ~67MB). Flat filename directly in /media/internal/, no subdirectory --
// fs.mkdirSync silently fails in this jail (established elsewhere in this
// file already, see CREDENTIALS_FILE below).
//
// Async job pattern deliberately mirrors DMBroker's own add/status split
// in the sibling `dailymotion` project (addDailymotionVideo -> job_id ->
// checkVideoStatus poll loop) -- same shape, just self-hosted: no cancel
// endpoint here either (matching that project's own "no cancel on the
// server side" reality), and no real byte-progress tracking for this
// first pass (status is just downloading/ready/failed) -- add later if
// this direction pans out and progress UX actually matters.
var VIDEO_CACHE_PREFIX = '/media/internal/mlbatbat_video_';
var videoJobs = {}; // jobId -> { status: "downloading"|"ready"|"failed", localPath, error }
var VIDEO_HTTP_PORT = 9877;

// Deliberately narrow -- serves ONLY files this same service downloaded
// via downloadEspnVideo under VIDEO_CACHE_PREFIX, not a general static
// file server. Range support (206 Partial Content) since video players
// commonly issue range requests to start playback/seek before the whole
// response has arrived -- fs.createReadStream's {start,end} option has
// existed since Node's earliest versions, predating this file's own
// documented "ancient Node quirks" (no Buffer.concat/appendFileSync etc.),
// so this is expected safe on this device's v0.4.12 build, unlike those.
function startVideoHttpServer() {
	try {
		http.createServer(function (req, res) {
			// Matches EITHER .mp4 (downloadEspnVideo's single-file path --
			// genuine MP4 container) OR .ts (downloadEspnVideoHls's
			// concatenated-segments path -- genuine raw MPEG-TS, despite
			// videoJobs' own playUrl/localPath historically being named
			// ".mp4" regardless of real content). Serving TS content
			// honestly as .ts / video/mp2t, not mislabeled as .mp4 /
			// video/mp4, per direct user report (2026-08-09): percentage
			// and download now work, player launches, but still won't
			// actually play -- the one thing about this whole HLS
			// approach that was flagged as unverified when proposed
			// (whether the system player's own demuxer selection trusts
			// Content-Type/extension over sniffing real content) is the
			// most likely remaining culprit, since every other step in
			// this pipeline is now confirmed working.
			var match = /^\/video\/([^\/]+)\.(mp4|ts)$/.exec(req.url);
			if (!match) {
				res.writeHead(404);
				res.end();
				return;
			}
			var ext = match[2];
			var filePath = VIDEO_CACHE_PREFIX + match[1] + '.' + ext;
			fs.stat(filePath, function (err, stat) {
				if (err) {
					res.writeHead(404);
					res.end();
					return;
				}
				var start = 0, end = stat.size - 1, status = 200;
				var range = req.headers && req.headers.range;
				if (range) {
					var m = /bytes=(\d*)-(\d*)/.exec(range);
					if (m) {
						if (m[1]) { start = parseInt(m[1], 10); }
						if (m[2]) { end = parseInt(m[2], 10); }
						status = 206;
					}
				}
				var headers = {
					'Content-Type': (ext === 'ts') ? 'video/mp2t' : 'video/mp4',
					'Content-Length': (end - start + 1),
					'Accept-Ranges': 'bytes'
				};
				if (status === 206) {
					headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
				}
				res.writeHead(status, headers);
				// HEAD gets headers only, no body -- confirmed live
				// Reverted back to always streaming the body regardless of
				// req.method -- an earlier session added a HEAD-only
				// (headers-no-body) branch here based on a novacom-run
				// curl -sI test that looked like it proved this server was
				// mishandling HEAD requests. That diagnosis doesn't hold
				// up: later in the same investigation, novacom's own CLI
				// was confirmed to silently eat/misparse short dash-flags
				// matching its own reserved letters (-s and -I both are),
				// meaning that "confirming" test may never have sent a
				// real HEAD request to curl at all. Reverted per direct
				// user instruction to restore the exact code that was
				// running at the last confirmed-working on-device test
				// ("It's working!!!!!") rather than keep an unverified
				// change layered on top of it. See this project's own
				// mlbatbat_video_playback_platform_limit memory for the
				// fuller investigation and why in-app playback beyond
				// this point is a separate, confirmed platform limitation
				// (LunaSysMgr/palmvideosink window registration), not
				// something this HTTP server can fix either way.
				fs.createReadStream(filePath, { start: start, end: end }).pipe(res);
			});
		}).listen(VIDEO_HTTP_PORT);
		absDebugLog('video HTTP server listening on port ' + VIDEO_HTTP_PORT);
	} catch (e) {
		absDebugLog('startVideoHttpServer failed: ' + e);
	}
}
startVideoHttpServer();

// Reverted back to a single curl call, no separate HEAD-for-Content-Length
// lookup and no progress percentage -- an earlier session added those
// (extra `cp.spawn(CURL, ['-ksSI', ...])` HEAD request before the real
// download, plus fs.stat-based percentage tracking) per direct user
// request, but per a LATER direct user report, the version of this app
// WITH that change couldn't play video at all ("player launches, can't
// play") while a separately-kept older build (working.ipk, this
// project's own root -- independently re-confirmed still playing video
// successfully on a different physical device, same session) using
// EXACTLY this single-curl-call form did not have that problem. Diffed
// working.ipk's own MLBAudioService.js directly rather than guessing --
// this function (not the relay server, not the launch call) was the one
// real functional difference between the two. Root cause not fully
// isolated (plausibly an extra request to ESPN's Akamai-fronted CDN
// right before the real download somehow affecting it, though not
// confirmed) -- reverted to match the proven-working reference exactly
// rather than keep debugging blind. The percentage feature is gone as a
// result; revisit later ONLY with a mechanism that adds no second
// network request (e.g. parsing curl's own stderr progress meter, or a
// spinner instead of a real percentage) rather than reintroducing this
// specific approach.
function downloadEspnVideo(args, callback) {
	args = args || {};
	if (!args.url || !args.jobId) {
		callback({ returnValue: false, error: 'downloadEspnVideo: url and jobId required' });
		return;
	}
	var jobId = String(args.jobId);
	var localPath = VIDEO_CACHE_PREFIX + jobId + '.mp4';
	videoJobs[jobId] = { status: 'downloading' };

	var curlArgs = ['-ksS', '-L', '-o', localPath, args.url];
	var p = cp.spawn(CURL, curlArgs);
	var errbuf = '';
	if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
	p.on('error', function (e) {
		videoJobs[jobId] = { status: 'failed', error: 'curl spawn error: ' + e };
	});
	p.on('exit', function (code) {
		absDebugLog('downloadEspnVideo exit code=' + code + ' jobId=' + jobId + ' url=' + args.url);
		if (code !== 0) {
			videoJobs[jobId] = { status: 'failed', error: 'curl exit ' + code + ' ' + errbuf };
			return;
		}
		videoJobs[jobId] = {
			status: 'ready',
			localPath: localPath,
			playUrl: 'http://127.0.0.1:' + VIDEO_HTTP_PORT + '/video/' + jobId + '.mp4'
		};
	});

	// Acks immediately with just the jobId -- the real result comes later,
	// from polling getEspnVideoDownloadStatus. Does NOT wait for curl's
	// 'exit' event (that's the whole point of the async job split).
	callback({ returnValue: true, jobId: jobId });
}

function getEspnVideoDownloadStatus(args, callback) {
	args = args || {};
	var jobId = String(args.jobId);
	var job = videoJobs[jobId];
	if (!job) {
		callback({ returnValue: false, error: 'getEspnVideoDownloadStatus: unknown jobId' });
		return;
	}
	// job.metubeJobId only set by downloadEspnVideoViaMetube -- absent
	// (undefined/harmless) for a downloadEspnVideo/downloadEspnVideoHlsLocal
	// job, which reports purely local state exactly as before. Once a
	// MeTube-backed job reaches a terminal state (ready/failed) there's
	// nothing further to poll either -- just report the cached result.
	if (!job.metubeJobId || job.status === 'ready' || job.status === 'failed') {
		callback({ returnValue: true, status: job.status, progress: job.progress, playUrl: job.playUrl, error: job.error });
		return;
	}

	httpRequest({
		url: METUBE_BASE_URL + '/status.php?job_id=' + encodeURIComponent(job.metubeJobId),
		method: 'GET',
		headers: { 'Client-Id': METUBE_CLIENT_ID }
	}, function (result) {
		if (!result.returnValue || !result.json || !result.json.status) {
			// A single missed poll isn't fatal -- report the last known
			// local state, same "let the app's own poll loop retry" spirit
			// every caller of this function already assumes.
			callback({ returnValue: true, status: job.status, progress: job.progress, playUrl: job.playUrl, error: job.error });
			return;
		}
		var mstatus = result.json.status;
		if (mstatus === 'ready') {
			var playUrl = metubeBuildPlayUrl(result.json.target || job.metubeTarget);
			absDebugLog('getEspnVideoDownloadStatus jobId=' + jobId + ' MeTube ready, playUrl=' + playUrl);
			videoJobs[jobId] = { status: 'ready', progress: 100, metubeJobId: job.metubeJobId, playUrl: playUrl };
			callback({ returnValue: true, status: 'ready', progress: 100, playUrl: playUrl });
		} else if (mstatus === 'failed') {
			var errMsg = result.json.error || 'MeTube conversion failed';
			absDebugLog('getEspnVideoDownloadStatus jobId=' + jobId + ' MeTube failed: ' + errMsg);
			videoJobs[jobId] = { status: 'failed', error: errMsg };
			callback({ returnValue: true, status: 'failed', error: errMsg });
		} else {
			// queued/downloading/converting -- collapsed to "downloading" for
			// the app, which (see views/VideosView.js's own gotStatus) only
			// ever distinguishes ready/failed/anything-else.
			var pct = (typeof result.json.progress === 'number') ? result.json.progress : job.progress;
			videoJobs[jobId].progress = pct;
			callback({ returnValue: true, status: 'downloading', progress: pct });
		}
	});
}

// ---------------------------------------------------------------------------
// downloadEspnVideoHls: root-caused live (2026-08-08) why ESPN's single
// progressive "HD" MP4 (what downloadEspnVideo above fetches) launches the
// system video player but never actually plays ("there was an error
// playing the file", every time, regardless of delivery mechanism tried --
// file://, this same local-relay approach, and a direct remote URL all
// failed identically): that file is encoded H.264 Main profile, LEVEL 5.1
// -- confirmed by hand-parsing its own moov/avcC box on a dev machine. A
// SEPARATE clip that WAS confirmed playing successfully on real hardware
// (an analyst-commentary clip, not a game highlight) is also 1280x720
// Main profile, but Level 3.1 -- this old (2011-era) hardware's own H.264
// decoder was very plausibly never built for anything past roughly that
// level, and ESPN's own HLS adaptive-bitrate ladder for the SAME game
// clip (links.source.HLS.href on the clip-detail response) already
// includes a 1280x720, 29.970fps rendition tagged avc1.64001f (Level
// 3.1) -- the exact level of the known-working clip. The only 1280x720
// HLS renditions at Level 3.2 (avc1.640020) are the two 59.92fps ones;
// ESPN's own adaptive ladder is careful about level per-rendition even
// though the single "mezzanine" progressive file isn't.
//
// VOD (not live) and unencrypted (no #EXT-X-KEY) -- confirmed live on
// this exact clip -- so this is simpler than the existing live-radio HLS
// handling elsewhere in this file: no live-edge-skipping, no AES-128
// decrypt, just a finite, ordered segment list to fetch and concatenate.
//
// ffmpeg on this device CANNOT remux the resulting .ts (confirmed live:
// "Invalid data found when processing input" -- its own --disable-demuxers
// build only re-enables wav/mov/aac/amr, no mpegts demuxer compiled in at
// all). Not needed anyway -- also confirmed live: GStreamer (what this
// device's own video pipeline, and presumably com.palm.app.videoplayer
// itself, actually runs on) DOES have MPEG-TS demux support
// (/usr/lib/gstreamer-0.10/libgstmpegtsdemux.so, confirmed present) --
// serving the raw concatenated .ts bytes directly (still named .mp4 to
// match startVideoHttpServer's existing URL/path convention, content-
// sniffed rather than extension-trusted by GStreamer's own auto-plugging)
// skips the remux step entirely.
//
// args: { hlsUrl, jobId }. Same videoJobs[] status shape as
// downloadEspnVideo above (downloading/ready/failed, playUrl on ready) --
// getEspnVideoDownloadStatus above already works for polling either kind
// of job without any changes.
//
// RENAMED from downloadEspnVideoHls to downloadEspnVideoHlsLocal, kept but
// UNWIRED (no command assistant calls this anymore -- see
// downloadEspnVideoViaMetube below, now called by
// DownloadEspnVideoHlsCommandAssistant instead) -- per direct user
// instruction (2026-08-09, after the metube.webosarchive.org maintainer
// authorized reusing the sibling `dailymotion` project's own Client-Id for
// this app's ESPN traffic too): this local download+concat pipeline is the
// documented root cause of [[mlbatbat_video_playback_platform_limit]]'s
// still-open bug (naive HLS segment concatenation produces a structurally
// invalid MPEG-TS stream that GStreamer's tsdemux/tsparse both choke on,
// intermittently -- confirmed NOT fixed as of this pipeline's last use).
// Left intact rather than deleted in case the MeTube route doesn't pan out
// and this needs to be the fallback again -- not currently reachable from
// any command, so safe to leave as-is with zero behavior risk to what's
// actually running.
function downloadEspnVideoHlsLocal(args, callback) {
	args = args || {};
	if (!args.hlsUrl || !args.jobId) {
		callback({ returnValue: false, error: 'downloadEspnVideoHls: hlsUrl and jobId required' });
		return;
	}
	var jobId = String(args.jobId);
	videoJobs[jobId] = { status: 'downloading' };
	callback({ returnValue: true, jobId: jobId });
	absDebugLog('downloadEspnVideoHls start jobId=' + jobId + ' hlsUrl=' + args.hlsUrl);

	var masterTmp = '/tmp/mlbatbat_hls_master-' + jobId + '-' + Date.now() + '.tmp';
	curlToFileAndRead(args.hlsUrl, masterTmp, function (result) {
		if (!result.returnValue || !result.raw) {
			absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' master playlist fetch FAILED: ' + JSON.stringify(result).substring(0, 200));
			videoJobs[jobId] = { status: 'failed', error: 'could not fetch HLS master playlist' };
			return;
		}
		var variantUrl = pickHlsVariant(result.raw, args.hlsUrl);
		if (!variantUrl) {
			absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' no suitable rendition in master playlist');
			videoJobs[jobId] = { status: 'failed', error: 'no suitable HLS rendition found' };
			return;
		}
		absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' picked variant=' + variantUrl);
		var variantTmp = '/tmp/mlbatbat_hls_variant-' + jobId + '-' + Date.now() + '.tmp';
		curlToFileAndRead(variantUrl, variantTmp, function (variantResult) {
			if (!variantResult.returnValue || !variantResult.raw) {
				absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' variant playlist fetch FAILED: ' + JSON.stringify(variantResult).substring(0, 200));
				videoJobs[jobId] = { status: 'failed', error: 'could not fetch HLS variant playlist' };
				return;
			}
			var segmentUrls = parseHlsSegmentUrls(variantResult.raw, variantUrl);
			if (!segmentUrls.length) {
				absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' variant playlist had zero segments');
				videoJobs[jobId] = { status: 'failed', error: 'HLS variant playlist had no segments' };
				return;
			}
			absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' segment count=' + segmentUrls.length);
			videoJobs[jobId] = { status: 'downloading', progress: 0, segmentTotal: segmentUrls.length, segmentsDone: 0 };
			downloadAndConcatSegments(jobId, segmentUrls);
		});
	});
}

// Picks the highest-bandwidth ~29.97fps rendition from a master playlist's
// text -- see downloadEspnVideoHls's own header comment for why 29.97fps
// specifically (it's what keeps the H.264 level at 3.1, not 3.2/5.1).
// Deliberately not just "highest bandwidth overall" -- that would pick a
// 59.92fps rendition on this specific ladder, right back into the
// same problem this whole function exists to avoid.
function pickHlsVariant(masterText, masterUrl) {
	var lines = masterText.split(/\r?\n/);
	var candidates = [];
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) {
			continue;
		}
		var frameRateMatch = /FRAME-RATE=([0-9.]+)/.exec(line);
		var bandwidthMatch = /BANDWIDTH=([0-9]+)/.exec(line);
		var resolutionMatch = /RESOLUTION=[0-9]+x([0-9]+)/.exec(line);
		if (!frameRateMatch || !bandwidthMatch) {
			continue;
		}
		var frameRate = parseFloat(frameRateMatch[1]);
		// 29.97fps is encoded as "29.970" on this playlist -- a small
		// tolerance window rather than an exact match in case a
		// differently-formatted value (e.g. "30.000") shows up elsewhere.
		// This is the actual safety filter that keeps this at H.264 Level
		// 3.1 (this device's confirmed-working level) instead of Level
		// 3.2/5.1 -- see this function's own header comment on
		// downloadEspnVideoHls. Every candidate below is already
		// guaranteed safe by this filter regardless of which resolution
		// tier ends up chosen.
		if (frameRate < 25 || frameRate > 31) {
			continue;
		}
		// The URI is the next non-blank line after this #EXT-X-STREAM-INF.
		var uriLine = (lines[i + 1] || '').replace(/\r$/, '');
		if (!uriLine || uriLine.charAt(0) === '#') {
			continue;
		}
		candidates.push({
			bandwidth : parseInt(bandwidthMatch[1], 10),
			height : resolutionMatch ? parseInt(resolutionMatch[1], 10) : 0,
			uri : uriLine
		});
	}
	if (!candidates.length) {
		return null;
	}
	// Prefer the resolution tier closest to 480p, then the LOWEST
	// bandwidth within that tier. Tried bumping this to 720p (closest
	// tier, highest bandwidth) once the 480p pipeline was fully confirmed
	// working end-to-end -- confirmed live (2026-08-09) the download/
	// concat side worked flawlessly at 720p too (correct rendition,
	// all 12 segments, valid ~26MB .ts file, all in ~13s), but playback
	// itself still failed the same way the original Level-5.1 clip did,
	// even though this 720p rendition is confirmed Level 3.1 -- same
	// profile/level as the working Olney clip and the working 480p
	// rendition, only resolution/bitrate differ. Root cause not isolated
	// (a device-memory/buffering limit specific to this resolution during
	// PLAYBACK, not decode capability or H.264 level, is the leading
	// theory, but unconfirmed) -- reverted back to 480p, the one
	// resolution with a real, repeated, confirmed-working track record,
	// rather than keep spending sessions chasing 720p on a device this
	// resource-constrained. Revisit only with a specific new lead, not
	// just because 720p “should” work on paper.
	candidates.sort(function (a, b) {
		var aDist = Math.abs(a.height - 480);
		var bDist = Math.abs(b.height - 480);
		if (aDist !== bDist) {
			return aDist - bDist;
		}
		return a.bandwidth - b.bandwidth;
	});
	return resolveHlsUrl(masterUrl, candidates[0].uri);
}

// Every non-comment, non-blank line in a media (variant) playlist is a
// segment URI, in playback order -- this VOD playlist has no
// #EXT-X-KEY/encryption and no live-edge concerns (#EXT-X-ENDLIST is
// always present), unlike this file's own live-radio HLS handling
// elsewhere, so nothing beyond a plain ordered list is needed.
function parseHlsSegmentUrls(variantText, variantUrl) {
	var lines = variantText.split(/\r?\n/);
	var urls = [];
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].replace(/\r$/, '');
		if (!line || line.charAt(0) === '#') {
			continue;
		}
		urls.push(resolveHlsUrl(variantUrl, line));
	}
	return urls;
}

// Resolves a (possibly relative) URI against the playlist URL that
// referenced it -- every URI seen live on ESPN's own playlists so far is
// a bare relative filename (e.g. "seg-1-f5-v1-a1.ts"), so this only
// handles that case plus already-absolute URLs, not a full RFC 3986
// resolver.
function resolveHlsUrl(baseUrl, uri) {
	if (/^https?:\/\//i.test(uri)) {
		return uri;
	}
	var lastSlash = baseUrl.lastIndexOf('/');
	return (lastSlash === -1 ? baseUrl : baseUrl.substring(0, lastSlash + 1)) + uri;
}

// Downloads every segment URL in order (sequential, not parallel -- a
// VOD clip this short is at most a dozen-ish segments, and sequential
// avoids piling up that many concurrent curl child processes in this
// jailed environment for no real benefit), then concatenates them via
// `cat` piped straight to the final destination file -- shelling out
// rather than reading/writing the bytes in-process, consistent with this
// file's own established preference for delegating heavy I/O to native
// tools given this ancient Node build's real memory constraints (see
// getAbsChallengeEvents' own header comment on V8 string-rope limits;
// the equivalent risk here is large in-memory Buffers, not strings, but
// the same "let a native tool do it" reasoning applies).
function downloadAndConcatSegments(jobId, segmentUrls) {
	var tmpDir = '/media/internal/';
	var segPaths = [];
	var index = 0;

	function downloadNext() {
		if (!videoJobs[jobId] || videoJobs[jobId].status !== 'downloading') {
			return; // job was superseded/cancelled client-side -- see isCurrentClip-style guards on the app side
		}
		if (index >= segmentUrls.length) {
			concatSegments();
			return;
		}
		var segPath = tmpDir + 'mlbatbat_hlsseg_' + jobId + '_' + index + '.ts';
		segPaths.push(segPath);
		// --max-time 60 -- each segment is small (typically 1-3MB for
		// this app's clips), 60s is generous even on a slow connection;
		// guarantees a hung segment fetch eventually fails the job
		// (status 'failed', visible to the user) instead of stalling the
		// whole sequential chain forever with no feedback.
		var curlArgs = ['-ksS', '--max-time', '60', '-o', segPath, segmentUrls[index]];
		var p = cp.spawn(CURL, curlArgs);
		p.on('error', function (e) {
			absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' segment ' + index + ' spawn error: ' + e);
			videoJobs[jobId] = { status: 'failed', error: 'segment download spawn error: ' + e };
		});
		p.on('exit', function (code) {
			if (code !== 0) {
				absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' segment ' + index + ' curl exit ' + code);
				videoJobs[jobId] = { status: 'failed', error: 'segment ' + index + ' curl exit ' + code };
				return;
			}
			index++;
			// Progress as a plain fraction of segments downloaded -- cheap
			// and purely LOCAL bookkeeping (no extra network request to
			// ESPN, unlike an earlier progress-percentage attempt on the
			// single-file download path that turned out to be the actual
			// cause of a real playback regression -- see this file's own
			// downloadEspnVideo comment). Capped at 99 until concatSegments
			// below actually finishes and marks the job ready, same
			// "don't claim done until it actually is" convention used
			// elsewhere in this file.
			if (videoJobs[jobId] && videoJobs[jobId].status === 'downloading') {
				videoJobs[jobId].segmentsDone = index;
				videoJobs[jobId].progress = Math.min(99, Math.floor((index / segmentUrls.length) * 100));
			}
			downloadNext();
		});
	}

	// In-process concatenation via fs.readFileSync/writeFileSync + manual
	// Buffer.copy() -- NOT cp.spawn('cat', ...).pipe(fs.createWriteStream)
	// (a previous version of this function did exactly that). Confirmed
	// live (2026-08-09) that version hung indefinitely at the concat step
	// specifically -- all 12 segments downloaded successfully in ~20s
	// (confirmed via this function's own "all segments downloaded" log
	// firing promptly), but the job never reached 'ready' and neither
	// catProc's 'error' event nor out's 'finish'/'error' events ever
	// fired, a silent hang with no error to react to. Every OTHER
	// subprocess-output consumer in this whole file already uses manual
	// `.on('data', ...)` handling instead of `.pipe()` on a ChildProcess
	// stream (see e.g. this file's own curlToFileAndRead/httpRequest) --
	// the one place `.pipe()` WAS already used successfully is
	// startVideoHttpServer's fs.ReadStream -> http.ServerResponse, a
	// completely different stream pairing. Rather than debug this
	// ancient (v0.4.12) Node build's own ChildProcess-stdout-to-
	// fs.WriteStream pipe behavior further, this sidesteps child_process
	// for the concat step entirely. No `Buffer.concat` either -- already
	// confirmed unavailable on this Node build (see this project's own
	// webos_ancient_node_quirks finding) -- so the combined buffer is
	// built manually via `.copy()` into a single pre-sized allocation.
	// Segment files here are small enough (a handful of MB total for a
	// ~1-minute 480p clip) that this carries none of the V8-string-rope
	// memory risk documented elsewhere in this file (getAbsChallengeEvents'
	// own header comment) -- that was specifically about repeated STRING
	// `+=` concatenation, which doesn't apply to Buffers at all.
	// Two-stage: raw byte concatenation (in-process, see this function's
	// own header comment for why not cp.spawn('cat')+.pipe()) into a TEMP
	// .ts, THEN a GStreamer remux (tsdemux -> mp4mux, NOT just serving the
	// raw concatenation) into the final .mp4. Added per direct user
	// report (2026-08-09): even after the earlier .ts/video-mp2t
	// Content-Type fix got ONE clip playing successfully, later clips
	// (and a repeat of that same clip) instead hung the system video
	// player's spinner indefinitely with no error at all -- a different
	// symptom than the original "there was an error playing the file".
	// Root cause: each HLS segment is an independently-encoded partial
	// transport stream with its OWN PAT/PMT tables and its OWN
	// discontinuous PCR/timestamp base -- naive byte concatenation
	// (`cat seg1 seg2 ...`) produces a technically-valid-per-segment but
	// NOT single-continuous-program stream. Real HLS-aware players
	// tolerate this by design (it's expected HLS behavior); this
	// device's plain local-file player (built for genuine single-program
	// files, no HLS awareness) can stall trying to resync at each
	// segment boundary instead of erroring cleanly. Confirmed both
	// `tsdemux` (mpegtsdemux plugin) and `mp4mux` (isomp4 plugin) exist
	// on this device's stock GStreamer install -- remuxing properly (not
	// just concatenating) produces a single clean MP4 with one
	// continuous set of stream tables, matching the exact container
	// shape of the one clip independently confirmed playing reliably (a
	// non-HLS, single-encode progressive file). This also lets serving
	// revert to plain .mp4/video/mp4 -- no more .ts special casing
	// needed once the final file is genuinely a clean MP4.
	// Reverted the GStreamer remux (tsdemux -> mp4mux) attempted here --
	// confirmed live (2026-08-09) it doesn't work: BOTH tsdemux and
	// tsparse (tried as a pre-cleanup stage) hard-error on this content
	// specifically ("Non-media stream (stream_type:0x15)... Stream
	// already present... Internal data stream error"), an ID3/timed-
	// metadata stream ESPN's encoder embeds in every segment that gets
	// redeclared at each segment boundary once segments are simply
	// concatenated -- a real structural problem with naive HLS-segment
	// concatenation that isn't fixable by swapping which GStreamer
	// element does the demuxing. Back to serving the raw concatenated
	// .ts directly (labeled/served correctly as .ts/video/mp2t, per the
	// earlier, separately-confirmed-working fix) -- this is the actual
	// last-known-good state, per direct user request, rather than
	// keep layering more fixes on the remux attempt.
	function concatSegments() {
		absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' all segments downloaded, concatenating (in-process)');
		var localPath = VIDEO_CACHE_PREFIX + jobId + '.ts';
		try {
			var buffers = [];
			var totalLength = 0;
			for (var i = 0; i < segPaths.length; i++) {
				var buf = fs.readFileSync(segPaths[i]);
				buffers.push(buf);
				totalLength += buf.length;
			}
			var combined = new Buffer(totalLength);
			var offset = 0;
			for (var j = 0; j < buffers.length; j++) {
				buffers[j].copy(combined, offset);
				offset += buffers[j].length;
			}
			fs.writeFileSync(localPath, combined);
			absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' ready, localPath=' + localPath + ' totalBytes=' + totalLength);
			videoJobs[jobId] = {
				status: 'ready',
				progress: 100,
				localPath: localPath,
				playUrl: 'http://127.0.0.1:' + VIDEO_HTTP_PORT + '/video/' + jobId + '.ts'
			};
		} catch (e) {
			absDebugLog('downloadEspnVideoHls jobId=' + jobId + ' concat failed: ' + (e && e.stack ? e.stack : e));
			videoJobs[jobId] = { status: 'failed', error: 'concat failed: ' + e };
		}
		cleanupSegments();
	}

	function cleanupSegments() {
		for (var i = 0; i < segPaths.length; i++) {
			try { fs.unlinkSync(segPaths[i]); } catch (e) { /* not fatal */ }
		}
	}

	downloadNext();
}

// ---------------------------------------------------------------------------
// downloadEspnVideoViaMetube: ACTIVE video pipeline as of 2026-08-09,
// replacing downloadEspnVideoHlsLocal above (see that function's own
// updated header comment). Routes through the real
// codepoet80/metube-php-servicewrapper hosted instance
// (metube.webosarchive.org) the sibling `dailymotion` project already uses
// for real, on-device-proven playback (see that project's own
// DMBroker-lib.js addDailymotionVideo/checkVideoStatus/buildPlayUrl,
// mirrored here almost line-for-line) -- yt-dlp's own mature HLS handling
// plus a full, unrestricted server-side ffmpeg transcode
// (-profile:v baseline, see that server's getconvertyoutube.sh) sidesteps
// this device's own naive-TS-concatenation bug entirely, instead of trying
// to hand-fix it locally.
//
// Client-Id below is this app's OWN metube-php-servicewrapper client
// identifier, issued 2026-08-18 -- no longer reusing the sibling
// `dailymotion` project's shared Client-Id (see this function's own header
// comment above for that now-superseded interim arrangement). server_id is
// unchanged: it's the servicewrapper's own shared transport secret (same
// value in the `dailymotion` project's MeTubeConfig.js), not a per-app
// credential. Per that project's own comment, this is obfuscation (client
// identification), not real security either way.
//
// clipUrl (NOT hlsUrl) -- an ESPN clip PAGE url
// (https://www.espn.com/video/clip/_/id/{id}), not the raw HLS master
// playlist -- yt-dlp has a dedicated ESPN extractor for this page shape,
// which is expected to be more robust than relying on its generic
// HLS-URL handling for an unusual master playlist. NOT independently
// verified end to end against the real metube.webosarchive.org server from
// here (no way to exercise a live third-party service during development
// the way on-device testing works for everything else in this file) --
// first real build should watch add.php/status.php's own responses via
// absDebugLog below if playback doesn't work.
var METUBE_BASE_URL = 'http://metube.webosarchive.org';
var METUBE_CLIENT_ID = 'mlb5OoHLbv7PmSBdizTwB';
var METUBE_SERVER_ID = 'nNWrp3bnH8GBdHj';

// metube-php-servicewrapper's request encoding scheme (see its own README/
// CLAUDE.md, and DMBroker-lib.js's identical _obfuscate): base64 the
// payload, then splice server_id in at a random position within the
// encoded string. new Buffer(...).toString('base64') (old-style
// constructor, matching this file's own established ancient-Node
// conventions elsewhere -- see the TS-concat Buffer.copy() usage above) --
// base64 is a core Buffer encoding on even this ancient Node build, unlike
// 'hex'/Buffer.concat which this project's own webos_ancient_node_quirks
// finding already confirmed missing.
function metubeObfuscate(plainText) {
	var b64 = new Buffer(plainText, 'utf8').toString('base64');
	var pos = Math.floor(Math.random() * (b64.length + 1));
	return b64.substring(0, pos) + METUBE_SERVER_ID + b64.substring(pos);
}

function metubeBuildPlayUrl(filename) {
	var requestId = metubeObfuscate(METUBE_CLIENT_ID + '|' + filename);
	return METUBE_BASE_URL + '/play.php?video=' + encodeURIComponent(filename) + '&requestid=' + encodeURIComponent(requestId);
}

// args: { clipUrl, jobId }. Same videoJobs[] status shape every other
// download path here already uses (downloading/ready/failed, playUrl on
// ready) -- getEspnVideoDownloadStatus below already polls whichever kind
// of job this is via job.metubeJobId, no app-side changes needed beyond
// what clip data gets passed in.
function downloadEspnVideoViaMetube(args, callback) {
	args = args || {};
	if (!args.clipUrl || !args.jobId) {
		callback({ returnValue: false, error: 'downloadEspnVideoViaMetube: clipUrl and jobId required' });
		return;
	}
	var jobId = String(args.jobId);
	videoJobs[jobId] = { status: 'downloading', progress: 0 };
	callback({ returnValue: true, jobId: jobId });
	absDebugLog('downloadEspnVideoViaMetube start jobId=' + jobId + ' clipUrl=' + args.clipUrl);

	var body = metubeObfuscate(args.clipUrl);
	httpRequest({
		url: METUBE_BASE_URL + '/add.php',
		method: 'POST',
		body: body,
		headers: {
			'Client-Id': METUBE_CLIENT_ID,
			'Convert': 'true',
			// Capped at 720p -- this device's decoder is confirmed working up
			// to a 720p/Level-3.1 H.264 stream (see
			// downloadEspnVideoHlsLocal's own header comment); no reason to
			// ask the server to fetch/transcode anything larger.
			'Quality': 'bestvideo[height<=720]'
		}
	}, function (result) {
		if (!result.returnValue || !result.json || result.json.status !== 'ok') {
			var errMsg = result.error || (result.json && result.json.msg) ||
				('add.php bad response: ' + (result.raw || '').substring(0, 200));
			absDebugLog('downloadEspnVideoViaMetube add.php FAILED jobId=' + jobId + ': ' + errMsg);
			videoJobs[jobId] = { status: 'failed', error: errMsg };
			return;
		}
		absDebugLog('downloadEspnVideoViaMetube add.php ok jobId=' + jobId +
			' metubeJobId=' + result.json.job_id + ' target=' + result.json.target);
		videoJobs[jobId] = {
			status: 'downloading',
			progress: 0,
			metubeJobId: result.json.job_id,
			metubeTarget: result.json.target
		};
	});
}

// ---------------------------------------------------------------------------
// Command assistants. Each reads request params and returns the player status.
// ---------------------------------------------------------------------------
function readArgs(self, future) {
	if (self && self.controller && self.controller.args) { return self.controller.args; }
	if (future && future.args) { return future.args; }
	return {};
}

var PlayCommandAssistant = function () {};
PlayCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	future.result = MLBAudioPlayer.play(args);
	return future;
};

var PauseCommandAssistant = function () {};
PauseCommandAssistant.prototype.run = function (future) {
	future.result = MLBAudioPlayer.pause();
	return future;
};

var ResumeCommandAssistant = function () {};
ResumeCommandAssistant.prototype.run = function (future) {
	future.result = MLBAudioPlayer.resume();
	return future;
};

var StopCommandAssistant = function () {};
StopCommandAssistant.prototype.run = function (future) {
	future.result = MLBAudioPlayer.stop();
	return future;
};

var GetStatusCommandAssistant = function () {};
GetStatusCommandAssistant.prototype.run = function (future) {
	future.result = MLBAudioPlayer.status();
	return future;
};

var SetVolumeCommandAssistant = function () {};
SetVolumeCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	future.result = MLBAudioPlayer.setVolume(args.volume);
	return future;
};

var GetVolumeCommandAssistant = function () {};
GetVolumeCommandAssistant.prototype.run = function (future) {
	future.result = MLBAudioPlayer.getVolume();
	return future;
};

// Async command -- per Foundations' own Future docs, future.result may be
// set later (not just synchronously before returning future), which is
// exactly what's needed here: httpRequest's callback fires once curl exits.
var HttpRequestCommandAssistant = function () {};
HttpRequestCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	httpRequest(args, function (result) {
		future.result = result;
	});
	return future;
};

var GetAbsChallengeEventsCommandAssistant = function () {};
GetAbsChallengeEventsCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	getAbsChallengeEvents(args, function (result) {
		future.result = result;
	});
	return future;
};

var DownloadEspnVideoCommandAssistant = function () {};
DownloadEspnVideoCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	downloadEspnVideo(args, function (result) {
		future.result = result;
	});
	return future;
};

// Command name unchanged (downloadEspnVideoHls, services.json) even though
// this now calls downloadEspnVideoViaMetube, not downloadEspnVideoHlsLocal
// -- no reason to touch services.json or either app-side caller's own
// method:"downloadEspnVideoHls" (views/VideosView.js, views/
// GameSummaryView.js) just because the SERVER-side implementation switched
// pipelines; only the call args changed (clipUrl instead of hlsUrl -- see
// those files' own updated playClip).
var DownloadEspnVideoHlsCommandAssistant = function () {};
DownloadEspnVideoHlsCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	downloadEspnVideoViaMetube(args, function (result) {
		future.result = result;
	});
	return future;
};

var GetEspnVideoDownloadStatusCommandAssistant = function () {};
GetEspnVideoDownloadStatusCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	getEspnVideoDownloadStatus(args, function (result) {
		future.result = result;
	});
	return future;
};

// ---------------------------------------------------------------------------
// "Remember me" credential storage for views/AudioView.js's MLB.com login
// form. Encrypted with openssl (same tool/reasoning as _decryptFile's HLS
// segment decryption above -- this jail has no /dev/random, so anything
// needing real crypto goes through openssl's own OpenSSL build, which is
// happy seeding from /dev/urandom instead), using a key that's generated
// once and kept ONLY here in the service's own storage -- the app's own
// WebKit-side code (and therefore its own localStorage, readable via a
// plain sqlite3 query against this app's localstorage file, confirmed live
// elsewhere this project) never sees the key or the raw ciphertext file,
// only ever the plaintext username/password it explicitly asked to remember
// or retrieve.
//
// /media/internal/ (not /tmp) -- needs to survive a reboot, unlike /tmp's
// tmpfs. No subdirectory: fs.mkdirSync() is confirmed silently failing for
// EVERY call inside this jail (see SEGMENT_TMP_PREFIX's own comment above)
// -- these two files sit directly in /media/internal/ with a dotfile-style
// prefix instead, so they don't need one.
// ---------------------------------------------------------------------------
var CREDENTIALS_KEY_FILE = '/media/internal/.mlbatbat_svc_key';
var CREDENTIALS_FILE = '/media/internal/.mlbatbat_svc_creds';

// Generates (once) and returns the AES-128 key, as a hex string, used for
// all credential encryption -- same on-disk key every time, so anything
// encrypted with it stays decryptable across app restarts/reboots.
function getOrCreateCredentialsKey(callback) {
	try {
		var existing = fs.readFileSync(CREDENTIALS_KEY_FILE, 'utf8').replace(/\s+/g, '');
		if (existing) {
			callback(null, existing);
			return;
		}
	} catch (e) { /* doesn't exist yet -- generate below */ }

	var p = cp.spawn(OPENSSL, ['rand', '-hex', '16']);
	var out = '', errbuf = '';
	if (p.stdout) { p.stdout.on('data', function (d) { out += d; }); }
	if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
	p.on('error', function (e) { callback('openssl rand spawn error: ' + e); });
	p.on('exit', function (code) {
		if (code !== 0) { callback('openssl rand exit ' + code + ' ' + errbuf); return; }
		var key = out.replace(/\s+/g, '');
		try {
			fs.writeFileSync(CREDENTIALS_KEY_FILE, key);
		} catch (e) {
			callback('writing key file failed: ' + e);
			return;
		}
		callback(null, key);
	});
}

// args: { username, password }. Encrypts {username, password} as JSON with
// AES-128-CBC (keyed by getOrCreateCredentialsKey, a fresh random IV per
// call -- reusing a fixed IV would let two saves of the same credentials
// produce identical ciphertext, a real if minor weakness worth avoiding
// since generating a new one is nearly free). Stored as one text file:
// the IV (hex) on the first line, base64 ciphertext on the rest -- openssl's
// own -a/-base64 flag, avoiding any binary-data-through-a-JS-string
// encoding risk (see this file's own established rope-string cautions
// elsewhere for why binary/large-string handling on this old Node build
// gets extra care).
function rememberCredentials(args, callback) {
	args = args || {};
	if (!args.username || !args.password) {
		callback({ returnValue: false, error: 'rememberCredentials: username and password required' });
		return;
	}
	getOrCreateCredentialsKey(function (err, key) {
		if (err) {
			callback({ returnValue: false, error: 'rememberCredentials: ' + err });
			return;
		}
		var ivProc = cp.spawn(OPENSSL, ['rand', '-hex', '16']);
		var ivOut = '';
		if (ivProc.stdout) { ivProc.stdout.on('data', function (d) { ivOut += d; }); }
		ivProc.on('exit', function (ivCode) {
			if (ivCode !== 0) {
				callback({ returnValue: false, error: 'rememberCredentials: iv generation failed' });
				return;
			}
			var iv = ivOut.replace(/\s+/g, '');
			var plain = JSON.stringify({ username: args.username, password: args.password });
			var tmpPlain = '/tmp/mlbatbat_cred_plain_' + Date.now() + '.json';
			var tmpEnc = tmpPlain + '.enc';
			try {
				fs.writeFileSync(tmpPlain, plain);
			} catch (e) {
				callback({ returnValue: false, error: 'rememberCredentials: writing tmp plaintext failed: ' + e });
				return;
			}
			var p = cp.spawn(OPENSSL, ['enc', '-aes-128-cbc', '-a', '-K', key, '-iv', iv, '-in', tmpPlain, '-out', tmpEnc]);
			var errbuf = '';
			if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
			p.on('exit', function (code) {
				try { fs.unlinkSync(tmpPlain); } catch (e) { /* not fatal */ }
				if (code !== 0) {
					callback({ returnValue: false, error: 'rememberCredentials: openssl enc exit ' + code + ' ' + errbuf });
					return;
				}
				var cipherText;
				try {
					cipherText = fs.readFileSync(tmpEnc, 'utf8');
					fs.unlinkSync(tmpEnc);
				} catch (e) {
					callback({ returnValue: false, error: 'rememberCredentials: reading tmp ciphertext failed: ' + e });
					return;
				}
				try {
					fs.writeFileSync(CREDENTIALS_FILE, iv + '\n' + cipherText);
				} catch (e) {
					callback({ returnValue: false, error: 'rememberCredentials: writing credentials file failed: ' + e });
					return;
				}
				callback({ returnValue: true });
			});
		});
	});
}

// No args. Returns { returnValue: true, found: false } if nothing's been
// remembered (not an error -- the normal "never checked remember me" case),
// or { returnValue: true, found: true, username, password } once decrypted.
function getRememberedCredentials(args, callback) {
	var raw;
	try {
		raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
	} catch (e) {
		callback({ returnValue: true, found: false });
		return;
	}
	var newlineIdx = raw.indexOf('\n');
	if (newlineIdx === -1) {
		callback({ returnValue: false, error: 'getRememberedCredentials: malformed credentials file' });
		return;
	}
	var iv = raw.slice(0, newlineIdx).replace(/\s+/g, '');
	var cipherText = raw.slice(newlineIdx + 1);
	getOrCreateCredentialsKey(function (err, key) {
		if (err) {
			callback({ returnValue: false, error: 'getRememberedCredentials: ' + err });
			return;
		}
		var tmpEnc = '/tmp/mlbatbat_cred_enc_' + Date.now() + '.txt';
		var tmpPlain = tmpEnc + '.dec';
		try {
			fs.writeFileSync(tmpEnc, cipherText);
		} catch (e) {
			callback({ returnValue: false, error: 'getRememberedCredentials: writing tmp ciphertext failed: ' + e });
			return;
		}
		var p = cp.spawn(OPENSSL, ['enc', '-d', '-aes-128-cbc', '-a', '-K', key, '-iv', iv, '-in', tmpEnc, '-out', tmpPlain]);
		var errbuf = '';
		if (p.stderr) { p.stderr.on('data', function (d) { errbuf += d; }); }
		p.on('exit', function (code) {
			try { fs.unlinkSync(tmpEnc); } catch (e) { /* not fatal */ }
			if (code !== 0) {
				callback({ returnValue: false, error: 'getRememberedCredentials: openssl dec exit ' + code + ' ' + errbuf });
				return;
			}
			var plain;
			try {
				plain = fs.readFileSync(tmpPlain, 'utf8');
				fs.unlinkSync(tmpPlain);
			} catch (e) {
				callback({ returnValue: false, error: 'getRememberedCredentials: reading tmp plaintext failed: ' + e });
				return;
			}
			var parsed;
			try {
				parsed = JSON.parse(plain);
			} catch (e) {
				callback({ returnValue: false, error: 'getRememberedCredentials: decrypted content was not valid JSON' });
				return;
			}
			callback({ returnValue: true, found: true, username: parsed.username, password: parsed.password });
		});
	});
}

// No args. Deletes any remembered credentials -- called when the user
// unchecks "remember me" (or checks it, then logs in with different
// credentials than whatever was previously remembered).
function forgetCredentials(args, callback) {
	try {
		fs.unlinkSync(CREDENTIALS_FILE);
	} catch (e) { /* nothing remembered -- not an error */ }
	callback({ returnValue: true });
}

var RememberCredentialsCommandAssistant = function () {};
RememberCredentialsCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	rememberCredentials(args, function (result) {
		future.result = result;
	});
	return future;
};

var GetRememberedCredentialsCommandAssistant = function () {};
GetRememberedCredentialsCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	getRememberedCredentials(args, function (result) {
		future.result = result;
	});
	return future;
};

var ForgetCredentialsCommandAssistant = function () {};
ForgetCredentialsCommandAssistant.prototype.run = function (future) {
	var args = readArgs(this, future);
	forgetCredentials(args, function (result) {
		future.result = result;
	});
	return future;
};
