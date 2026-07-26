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
var WATCHDOG_TIMEOUT_MS = 4000; // how long without a status() call before the watchdog assumes the app is gone and stops playback -- 4x the app's own 1s getStatus poll interval, enough margin to tolerate a slow/missed poll without false-triggering during real playback (confirmed live at 3000/10000 that this general approach works; tightened after that to cut detection latency)

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
	lastError: '',
	volume: 100,              // 0-100, this service's OWN PulseAudio stream gain (see file header -- no reachable API for the real system volume)
	watchdogTimer: null,      // see _watchdogCheck
	lastStatusPollAt: 0,      // Date.now() of the last status() call -- fed by every app-originated command (getStatus's 1s poll, but also play/pause/resume/stop/setVolume, all of which return status()), consumed by _watchdogCheck

	log: function (msg) {
		if (typeof console !== 'undefined' && console.log) {
			console.log('[MLBAudioPlayer] ' + msg);
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
		this.log(msg);
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
			self.log('gst exit code=' + code + ' sig=' + sig);
			self.child = null;
			if (self.state === 'playing' || self.state === 'paused') {
				self.state = (code === 0) ? 'ended' : 'error';
				if (code !== 0) { self.lastError = 'gst exit code ' + code; }
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
			this.log('_watchdogCheck: no status() call in ' + WATCHDOG_TIMEOUT_MS + 'ms, assuming app is gone -- stopping playback');
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
			return this.resume();
		}

		this._kill();
		this.url = args.url;
		this.variantUrl = '';
		this.heartbeatUrl = args.heartbeatUrl || '';
		this.heartbeatInterval = args.heartbeatInterval || 60;
		this.knownSegments = {};
		this.lastError = '';
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
		callback({ returnValue: false, error: 'httpRequest: no url given' });
		return;
	}

	// --compressed defensively -- see _curlText's comment for why this
	// matters: a gzip-compressed response silently misparses as garbage
	// rather than erroring, which is a much worse failure mode than just
	// adding this unconditionally (a no-op against an uncompressed reply).
	var curlArgs = ['-ksS', '--compressed', '-X', (args.method || 'POST'), '-w', '\n%{http_code}'];
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
		callback({ returnValue: false, error: 'curl spawn error: ' + e });
	});
	p.on('exit', function (code) {
		if (code !== 0) {
			callback({ returnValue: false, error: 'curl exit ' + code + ' ' + errbuf });
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
			raw: json ? undefined : bodyText
		});
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
