// Live radio playback flow -- rebuilt against MLB's real Okta/GraphQL auth
// chain and the custom com.mlb.atbat2011.service Luna service (see that
// service's MLBAudioService.js for why a custom gst-launch-backed service
// is needed at all: this device's HTML5 <audio>/native media player can't
// play anything, HLS or otherwise, due to a missing GStreamer element).
//
// The original flow here POSTed SOAP to MLB's identityPoint/fulfillment/
// MediaService2_0 endpoints and played the result through Enyo's built-in
// Sound kind -- both are gone: the endpoints are dead, and even a working
// URL couldn't play through Sound on this hardware. Replaced with:
// getDeviceId (kept, unrelated to the dead feed) -> get a cached Okta
// token or prompt an interactive login (real MLB.com credentials are
// required now, unlike the old anonymous per-device identity) ->
// initSession -> initPlaybackSession(feed.mediaId) -> hand the resulting
// URL + heartbeat info to the service via PalmService "play". See
// lib/OktaAuth.js / lib/MLBMediaGateway.js for the endpoints themselves.
//
// The flowSteps/businessLogic/continueFlow state-machine skeleton (a
// recursive-descent walk that re-enters businessLogic after each async
// step completes, advancing until every precondition for the next step is
// met) is kept unchanged from the original -- it was already the right
// shape for chaining a pile of async webOS service calls, and
// views/AudioView.js already depends on the flowListener/sendAudioMessage
// contract this produces.
//
// IMPORTANT: the Okta login POST and the GraphQL calls do NOT go over this
// app's own WebKit networking (unlike everything else in this app, e.g.
// the broadcasts/scoreboard fetches) -- confirmed live that MLB's Okta
// tenant actively refuses the password grant when the request looks like
// it came from a browser (`error=unauthorized_client,
// error_description=Browser requests to the token endpoint may only use
// the authorization_code grant_type.`), which a WebKit XHR always does
// (via Origin/Referer) and a bare curl process never does. Both go through
// com.mlb.atbat2011.service's generic `httpRequest` command instead (see
// that service's MLBAudioService.js), which shells out to curl -- this
// service already reliably does non-browser-looking HTTPS for HLS segment
// fetching, for an unrelated reason (this jail has no /dev/random). This
// app (lib/OktaAuth.js/lib/MLBMediaGateway.js) still builds every request
// body/header and parses every response; the service is just the
// transport, no MLB-specific logic lives there.
enyo
		.kind( {
			name : "mlb.AudioFlow",
			kind: "enyo.VFlexBox",
			published:{
				lastFlowItem : null,
				lastFlowResponse : null,
				flowSteps : {},
				flowParams : {},
				flowListeners:{},

				url:null,
				game:null,
				feed:null,
				feedName:"",
				status: "NotPlaying",
				statusMessage:"Not Playing",

				// Whether this app's card is the active/foreground window --
				// starts true since the app is always in the foreground at
				// launch. See windowActivated/windowDeactivated/updateDashboard.
				windowActive: true,

				statusPollTimer: null,
				// Which in-flight httpRequestCmd call this is, so the one shared
				// onSuccess/onFailure handler knows how to interpret/route the
				// response -- "login" | "initSession" | "initPlaybackSession".
				// See httpRequestReturn.
				httpRequestPurpose: null
			},

			components : [
				{
					name : "httpRequestCmd",
					kind : "PalmService",
					service : "palm://com.mlb.atbat2011.service/",
					method : "httpRequest",
					onSuccess : "httpRequestReturn",
					onFailure : "httpRequestFailure"
				},
				{
					name : "audioPlayCmd",
					kind : "PalmService",
					service : "palm://com.mlb.atbat2011.service/",
					method : "play",
					onSuccess : "audioPlayReturn",
					onFailure : "palmServiceFailure"
				},
				{
					name : "audioPauseCmd",
					kind : "PalmService",
					service : "palm://com.mlb.atbat2011.service/",
					method : "pause",
					onFailure : "palmServiceFailure"
				},
				{
					name : "audioResumeCmd",
					kind : "PalmService",
					service : "palm://com.mlb.atbat2011.service/",
					method : "resume",
					onFailure : "palmServiceFailure"
				},
				{
					name : "audioStopCmd",
					kind : "PalmService",
					service : "palm://com.mlb.atbat2011.service/",
					method : "stop",
					onFailure : "palmServiceFailure"
				},
				{
					name : "audioGetStatusCmd",
					kind : "PalmService",
					service : "palm://com.mlb.atbat2011.service/",
					method : "getStatus",
					onSuccess : "audioGetStatusReturn"
					// deliberately no onFailure -- this fires on a 1s poll
					// timer, a single transient failure isn't worth surfacing
					// as a status change, the next poll will just try again
				},
				// System notification-area "now playing" widget -- see
				// updateDashboard()/windowActivated()/windowDeactivated()
				// below. smallIcon is the persistent icon shown in the
				// notification area itself; pushed layers are what expand
				// out of it when the user pulls it down.
				{
					name : "dashboard",
					kind : "Dashboard",
					smallIcon : "imgs/icon.png",
					onTap : "dashboardTap",
					onUserClose : "dashboardUserClose"
				},
				// onWindowActivated/onWindowDeactivated fire as the user
				// switches this app's card in and out of the foreground --
				// see windowActivated/windowDeactivated. onUnload fires when
				// the card itself is closed (tossed away) -- the playback
				// service is a separate long-running process
				// (com.mlb.atbat2011.service) that outlives this app's own
				// window, so it never stops on its own just because the app
				// UI closed; see windowUnloaded.
				{
					kind : "ApplicationEvents",
					onWindowActivated : "windowActivated",
					onWindowDeactivated : "windowDeactivated",
					onUnload : "windowUnloaded"
				}
			],

			create : function() {
				console.log("Create AudioFlow");
				this.inherited(arguments);
				this.setupFlow();

			},
			addFlowListener:function(name, listener) {
				this.flowListeners[name] = listener;
				listener(this.createAudioMessage());
			},
			removeFlowListener:function(name, listener) {
				delete this.flowListeners[name];
			},
			createAudioMessage:function() {
				return {
					"feed": this.feed,
					"game": this.game,
					"feedName": this.feedName,
					"feedUrl": this.url,
					"status":this.status,
					"statusMessage":this.statusMessage
				};

			},
			sendAudioMessage:function(){

				var message = this.createAudioMessage();
				console.log("SENDING AUDIO MESSAGE!!: " + printAsStr(message));

				this.updateDashboard();

				for(var i in this.flowListeners) {

					this.flowListeners[i](message);
				}
			},

			// Reflects current playback state in the system notification-area
			// dashboard -- called on every status/feed change via
			// sendAudioMessage, and on every foreground/background switch via
			// windowActivated/windowDeactivated. Previously only shown while
			// this app wasn't the foreground window (a "still playing in
			// background" indicator, avoiding a duplicate of
			// views/AudioView.js's own in-popup controls) -- but
			// views/GamedayView.js's radio popup now closes immediately
			// after a feed is picked (no in-app player UI left visible at
			// all), and the whole point of that design is that the
			// notification-area widget is the ONLY playback surface
			// afterward, in foreground or background alike, so the user can
			// keep browsing the rest of the app while listening. Shown
			// whenever audible now, regardless of window focus.
			updateDashboard: function() {
				var audible = (this.status == "NowPlaying" || this.status == "Paused" || this.status == "Buffering");
				if (!audible) {
					this.$.dashboard.setLayers([]);
					return;
				}
				this.$.dashboard.setLayers([{
					// Icon shows the action a tap performs, not the current
					// state -- pause icon while playing (tap to pause), play
					// icon while paused (tap to resume), matching standard
					// media-notification convention.
					icon: (this.status == "Paused") ? "imgs/audio/btn_play.png" : "imgs/audio/btn_pause.png",
					title: "At Bat: " + (this.feedName || "Radio"),
					text: this.statusMessage
				}]);
			},

			windowActivated: function() {
				this.windowActive = true;
				this.updateDashboard();
			},
			windowDeactivated: function() {
				this.windowActive = false;
				this.updateDashboard();
			},
			// Card tossed away -- stop the backend service explicitly, since
			// it has no other way to know the app is gone.
			windowUnloaded: function() {
				this.stopAudio();
			},

			// Tapping anywhere on the dashboard toggles play/pause -- mirrors
			// the in-app play/pause button rather than relaunching the app.
			dashboardTap: function() {
				if (this.status == "NowPlaying") {
					this.pauseAudio();
				} else if (this.status == "Paused") {
					this.resumeAudio();
				}
			},
			// User swiped the dashboard away -- kill playback entirely rather
			// than leaving the service running with no visible way to stop it.
			dashboardUserClose: function() {
				this.stopAudio();
			},

			startAudioFlow : function(feed,game) {

				if(this.feed) {
					this.stopAudio();
				}
				console.log("startAudioFlow");
				this.feed = feed;
				this.game = game;
				this.feedName = feed.callSign;

				this.lastFlowItem = null;
				this.lastFlowResponse = null;
				this.flowParams = {};

				this.businessLogic();
			},

			// Called by views/AudioView.js's inline login form once the user
			// submits it. Only meaningful while a flow is actually parked in
			// the NeedsLogin state waiting on this -- see businessLogic().
			// Not the normal entry point any more -- see login() below --
			// kept as a safety net for the rare case where a feed is tapped
			// and the cached token has expired since the up-front login.
			submitLogin : function(username, password) {
				this.flowParams.username = username;
				this.flowParams.password = password;
				this.flowTo("login");
			},

			// Standalone login, independent of any particular feed/game --
			// used by views/AudioView.js to gate the whole popup on login
			// before showing any games/feeds at all (playback can't work
			// without a real MLB.com account either way, so there's no
			// point showing games before the user can play any of them).
			// callback(success) is invoked once, on success or failure --
			// on success the token is already cached (MLBAuth.cacheToken),
			// so a subsequent startAudioFlow() picks it up normally via its
			// own getCachedToken step without needing to log in again.
			login : function(username, password, callback) {
				this.loginCallback = callback;
				this.status = "LoggingIn";
				this.statusMessage = "Logging in...";
				this.sendAudioMessage();
				this.httpRequestPurpose = "login";
				this.$.httpRequestCmd.call( {
					url : MLBAuth.TOKEN_URL,
					method : "POST",
					headers : { "Content-Type" : "application/x-www-form-urlencoded" },
					body : MLBAuth.buildTokenRequestBody(username, password)
				});
			},

			// Tries the cached refresh token (if any) before ever falling back
			// to the password form -- this is what lets a user go days without
			// opening the app without being asked to log in again, since the
			// access token alone only lasts about an hour. callback(success)
			// invoked once, same contract as login() above. Reuses
			// httpRequestPurpose "login" deliberately: handleLoginResponse
			// already does exactly the right thing for either grant type
			// (parse the token response, cache access+refresh token, invoke
			// loginCallback) since Okta returns the identical response shape
			// for both -- no separate response-handling branch needed.
			// Used by views/AudioView.js's refreshLoginGate() (popup reopened
			// with only a refresh token left) and by flowSteps.getCachedToken
			// below (access token expired mid-session, feed tapped anyway).
			attemptSilentAuth : function(callback) {
				var refreshToken = MLBAuth.getCachedRefreshToken();
				if (!refreshToken) {
					callback(false);
					return;
				}
				this.loginCallback = callback;
				this.httpRequestPurpose = "login";
				this.$.httpRequestCmd.call( {
					url : MLBAuth.TOKEN_URL,
					method : "POST",
					headers : { "Content-Type" : "application/x-www-form-urlencoded" },
					body : MLBAuth.buildRefreshTokenRequestBody(refreshToken)
				});
			},

			pauseAudio:function() {
				if (this.status != "NowPlaying") {
					return;
				}
				this.status = "Paused";
				this.statusMessage ="Paused...";
				this.sendAudioMessage();
				this.$.audioPauseCmd.call({});
			},

			resumeAudio:function() {
				if (this.status != "Paused") {
					return;
				}
				this.status = "NowPlaying";
				this.statusMessage ="Now Playing...";
				this.sendAudioMessage();
				this.$.audioResumeCmd.call({});
			},

			stopAudio:function() {
				this.stopStatusPolling();
				this.status = "NotPlaying";
				this.statusMessage = "Not Playing";
				this.sendAudioMessage();
				this.$.audioStopCmd.call({});
			},

			startStatusPolling : function() {
				this.stopStatusPolling();
				var _self = this;
				this.statusPollTimer = setInterval(function() {
					_self.$.audioGetStatusCmd.call({});
				}, 1000);
			},
			stopStatusPolling : function() {
				if (this.statusPollTimer) {
					clearInterval(this.statusPollTimer);
					this.statusPollTimer = null;
				}
			},

			// Maps the service's own {state, url, error, ...} status object
			// (see MLBAudioService.js's status()) onto this flow's UI-facing
			// status/statusMessage and notifies listeners. Shared by the
			// play command's onSuccess and the 1s getStatus poll.
			applyServiceStatus : function(serviceStatus) {
				if (!serviceStatus) {
					return;
				}
				this.url = serviceStatus.url || this.url;

				if (serviceStatus.state == "downloading") {
					this.status = "Buffering";
					this.statusMessage = "Loading broadcast...";
				}
				else if (serviceStatus.state == "playing") {
					this.status = "NowPlaying";
					this.statusMessage = "Now Playing...";
				}
				else if (serviceStatus.state == "paused") {
					this.status = "Paused";
					this.statusMessage = "Paused...";
				}
				else if (serviceStatus.state == "error") {
					this.status = "PlaybackError";
					this.statusMessage = "Playback Error" + (serviceStatus.error ? ": " + serviceStatus.error : "...");
					this.stopStatusPolling();
				}
				else if (serviceStatus.state == "ended") {
					this.status = "PlaybackEnd";
					this.statusMessage = "Playback Stopped...";
					this.stopStatusPolling();
				}
				else {
					this.status = "NotPlaying";
					this.statusMessage = "Not Playing";
				}
				this.sendAudioMessage();
			},

			audioPlayReturn : function(inSender, inResponse) {
				this.applyServiceStatus(inResponse);
				if (inResponse && inResponse.returnValue) {
					this.startStatusPolling();
				}
			},
			audioGetStatusReturn : function(inSender, inResponse) {
				this.applyServiceStatus(inResponse);
			},
			palmServiceFailure : function(inSender, inResponse) {
				console.log("PalmService call failed: " + printAsStr(inResponse));
				this.status = "PlaybackError";
				this.statusMessage = "Playback Error...";
				this.stopStatusPolling();
				this.sendAudioMessage();
			},

			setupFlow : function() {

				var _self = this;
				this.flowSteps.getDeviceId = function() {
					// get the device id
					console.log("getDeviceId");
						var deviceInfo = enyo.fetchDeviceInfo();
						if(!deviceInfo) {
							deviceInfo = {"serialNumber":"11111111111111111111111111111112"};
						}
						_self.flowParams.deviceId = "palm_" + deviceInfo.serialNumber;

						_self.continueFlow( {
							"statusCode" : "success"
						});

				};

				this.flowSteps.getCachedToken = function() {
					console.log("getCachedToken");
					var cached = MLBAuth.getCachedToken();
					if (cached) {
						_self.flowParams.accessToken = cached;
						_self.continueFlow( { "statusCode" : "success" } );
						return;
					}
					// Access token expired/missing -- try the longer-lived
					// refresh token before falling back to the password form.
					// businessLogic()'s existing lastFlowItem=="getCachedToken"
					// -> needsLogin routing already handles the failure case
					// correctly once this re-enters via continueFlow below.
					_self.attemptSilentAuth(function(success) {
						if (success) {
							_self.flowParams.accessToken = MLBAuth.getCachedToken();
						}
						_self.continueFlow( { "statusCode" : success ? "success" : "fail" } );
					});
				};

				this.flowSteps.needsLogin = function() {
					console.log("needsLogin");
					_self.status = "NeedsLogin";
					_self.statusMessage = "Please log in with your MLB.com account";
					// Flow pauses here -- resumes via submitLogin(), called
					// externally by views/AudioView.js's login form.
				};

				this.flowSteps.login = function() {
					console.log("login");
					_self.status = "LoggingIn";
					_self.statusMessage = "Logging in...";
					var body = MLBAuth.buildTokenRequestBody(_self.flowParams.username, _self.flowParams.password);
					_self.flowParams.password = null; // don't keep the plaintext password around any longer than needed to build this one request
					_self.httpRequestPurpose = "login";
					_self.$.httpRequestCmd.call( {
						url : MLBAuth.TOKEN_URL,
						method : "POST",
						headers : { "Content-Type" : "application/x-www-form-urlencoded" },
						body : body
					});
				};

				this.flowSteps.initSession = function() {
					console.log("initSession");
					_self.status = "Initializing";
					_self.statusMessage = "Initializing...";
					_self.httpRequestPurpose = "initSession";
					_self.$.httpRequestCmd.call( {
						url : MLBMediaGateway.GRAPHQL_URL,
						method : "POST",
						headers : { "Content-Type" : "application/json", "Authorization" : "Bearer " + _self.flowParams.accessToken },
						body : MLBMediaGateway.buildInitSessionBody(_self.flowParams.deviceId)
					});
				};

				this.flowSteps.initPlaybackSession = function() {
					console.log("initPlaybackSession");
					_self.status = "Buffering";
					_self.statusMessage = "Buffering...";
					_self.httpRequestPurpose = "initPlaybackSession";
					_self.$.httpRequestCmd.call( {
						url : MLBMediaGateway.GRAPHQL_URL,
						method : "POST",
						headers : { "Content-Type" : "application/json", "Authorization" : "Bearer " + _self.flowParams.accessToken },
						body : MLBMediaGateway.buildInitPlaybackSessionBody(
							_self.feed.mediaId, _self.flowParams.mgDeviceId, _self.flowParams.mgSessionId)
					});
				};

				this.flowSteps.play = function() {
					console.log("play");
					_self.status = "Buffering";
					_self.statusMessage = "Buffering...";
					_self.$.audioPlayCmd.call( {
						"url" : _self.flowParams.playbackUrl,
						"heartbeatUrl" : _self.flowParams.heartbeatUrl,
						"heartbeatInterval" : _self.flowParams.heartbeatInterval
					});
				};

			},

			continueFlow : function(response) {

				this.lastFlowResponse = response;
				this.businessLogic();
			},
			flowTo : function(flowItemName) {

				this.lastFlowItem = flowItemName;
				this.lastFlowResponse = null;
				this.flowSteps[flowItemName]();
				this.sendAudioMessage();
			},
			businessLogic : function() {
				console.log("businessLogic, lastFlowItem=" + this.lastFlowItem
						+ " lastFlowResponse=" + printAsStr(this.lastFlowResponse));

				this.status="Initializing";
				this.statusMessage="Initializing...";

				// GET DEVICEID
				if (!this.flowParams.deviceId) {
					this.flowTo("getDeviceId");
					return;
				}

				// GET/PROMPT FOR AUTH
				if (!this.flowParams.accessToken) {
					if (this.lastFlowItem == "getCachedToken") {
						this.flowTo("needsLogin");
						return;
					}
					if (this.lastFlowItem == "needsLogin" || this.lastFlowItem == "login") {
						// Waiting on the user to submit the login form, or an
						// Okta POST is already in flight -- do nothing until
						// submitLogin()/httpRequestReturn drives the flow forward.
						return;
					}
					this.flowTo("getCachedToken");
					return;
				}

				// INIT MEDIA GATEWAY SESSION
				if (!this.flowParams.mgSessionId) {
					this.flowTo("initSession");
					return;
				}

				// INIT PLAYBACK SESSION (resolve feed.mediaId to a playable URL)
				if (!this.flowParams.playbackUrl) {
					this.flowTo("initPlaybackSession");
					return;
				}

				// PLAY
				this.flowTo("play");

			},

			// Single shared response handler for every httpRequestCmd call
			// (login, initSession, initPlaybackSession) -- inResponse is the
			// service's httpRequest result: { returnValue, status, json, raw }.
			// See MLBAudioService.js's httpRequest for that shape, and the file
			// header comment above for why these calls go through the service's
			// curl instead of this app's own WebKit networking.
			httpRequestReturn : function(inSender, inResponse) {
				var purpose = this.httpRequestPurpose;
				this.httpRequestPurpose = null;

				if (!inResponse || !inResponse.returnValue) {
					this.httpRequestFailed(purpose, inResponse);
					return;
				}

				if (purpose == "login") {
					this.handleLoginResponse(inResponse);
				}
				else if (purpose == "initSession") {
					this.handleInitSessionResponse(inResponse);
				}
				else if (purpose == "initPlaybackSession") {
					this.handleInitPlaybackSessionResponse(inResponse);
				}
			},
			httpRequestFailure : function(inSender, inResponse) {
				this.httpRequestFailed(this.httpRequestPurpose, inResponse);
				this.httpRequestPurpose = null;
			},
			// A Luna-bus-level failure (service not registered/running, crashed,
			// etc.) or a curl-level failure reported via returnValue:false --
			// NOT an HTTP error response from Okta/GraphQL themselves, those are
			// still "successful" Luna calls handled in handleLoginResponse/
			// handleInitSessionResponse/handleInitPlaybackSessionResponse.
			httpRequestFailed : function(purpose, inResponse) {
				var detail = (inResponse && inResponse.error) || "no response from the audio service";
				console.log("httpRequestFailed (" + purpose + "): " + detail);
				if (purpose == "login") {
					this.status = "LoginFailed";
					this.statusMessage = "Login failed: " + detail;
					this.sendAudioMessage();
					this.finishLoginCallback(false);
				}
				else {
					this.status = "PlaybackError";
					this.statusMessage = "Error starting playback: " + detail;
					this.sendAudioMessage();
				}
			},

			handleLoginResponse : function(inResponse) {
				var json = inResponse.json;
				var parsed = MLBAuth.parseTokenResponse(json);
				if (!parsed) {
					var detail;
					if (json && json.error) {
						// Okta's own OAuth error response -- e.g. wrong credentials,
						// or (see file header) a grant-type policy rejection.
						detail = json.error_description || json.error;
					}
					else if (inResponse.status) {
						detail = "HTTP " + inResponse.status + (inResponse.raw ? ": " + inResponse.raw.slice(0, 200) : "");
					}
					else {
						detail = "unexpected response";
					}
					console.log("login failed: " + detail);
					this.status = "LoginFailed";
					this.statusMessage = "Login failed: " + detail;
					this.sendAudioMessage();
					this.finishLoginCallback(false);
					return;
				}
				this.flowParams.accessToken = parsed.accessToken;
				MLBAuth.cacheToken(parsed.accessToken, parsed.expiresIn);
				if (parsed.refreshToken) {
					MLBAuth.cacheRefreshToken(parsed.refreshToken);
				}

				if (this.loginCallback) {
					this.status = "NotPlaying";
					this.statusMessage = "Not Playing";
					this.sendAudioMessage();
					this.finishLoginCallback(true);
					return;
				}
				this.continueFlow( {
					"statusCode" : "success"
				});
			},
			// Invokes and clears this.loginCallback (set only by the
			// standalone login() call, never by the feed-flow's reactive
			// submitLogin()/needsLogin path) -- a no-op the rest of the time.
			finishLoginCallback : function(success) {
				if (this.loginCallback) {
					var cb = this.loginCallback;
					this.loginCallback = null;
					cb(success);
				}
			},

			handleInitSessionResponse : function(inResponse) {
				var session = MLBMediaGateway.parseInitSessionResponse(inResponse.json);
				if (!session) {
					this.mediaGatewayError(inResponse);
					return;
				}
				this.flowParams.mgDeviceId = session.deviceId;
				this.flowParams.mgSessionId = session.sessionId;
				this.continueFlow( {
					"statusCode" : "success"
				});
			},
			handleInitPlaybackSessionResponse : function(inResponse) {
				var playback = MLBMediaGateway.parseInitPlaybackSessionResponse(inResponse.json);
				if (!playback) {
					this.mediaGatewayError(inResponse);
					return;
				}
				this.flowParams.playbackUrl = playback.url;
				this.flowParams.heartbeatUrl = playback.heartbeatUrl;
				this.flowParams.heartbeatInterval = playback.heartbeatInterval;
				this.continueFlow( {
					"statusCode" : "success"
				});
			},
			mediaGatewayError : function(inResponse) {
				var detail = (inResponse && inResponse.json && inResponse.json.errors && inResponse.json.errors[0] && inResponse.json.errors[0].message)
					|| (inResponse && inResponse.raw && inResponse.raw.slice(0, 200))
					|| "unexpected response";
				console.log("mediaGatewayError: " + detail);
				this.status = "PlaybackError";
				this.statusMessage = "Error starting playback: " + detail;
				this.sendAudioMessage();
			}

		});
