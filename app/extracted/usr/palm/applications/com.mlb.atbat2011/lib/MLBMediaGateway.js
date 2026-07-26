// MLB's media-gateway GraphQL API -- the real auth-to-playback-URL chain
// behind live radio (see lib/AudioFlow.js). Query shapes below were
// reverse-engineered live this session (see project plan's Sub-phase A):
// initSession needed a clientType argument and entitlements{code}
// subselection neither obvious from third-party reference code; the exact
// playback/heartbeatInfo field names were found via this endpoint's own
// GraphQL introspection (__type(name:"...")), not guessed. Confirmed
// working end-to-end (a real archived broadcast played back audibly on
// this device) before being ported here.
//
// NOT called via this app's own WebKit networking (no enyo.WebService kind
// here) -- these calls share the same auth trust boundary as Okta's login
// (see lib/OktaAuth.js's header comment for why that specifically can't go
// through a browser-looking request) and were never independently
// confirmed safe from a real device/browser context either, only from
// harness testing. Sent via com.mlb.atbat2011.service's generic curl-backed
// `httpRequest` command instead (see lib/AudioFlow.js's flowSteps.
// initSession/initPlaybackSession) -- this object only builds request
// bodies and parses responses, transport-agnostic.
var MLBMediaGateway = {
	GRAPHQL_URL: "https://media-gateway.mlb.com/graphql",

	INIT_SESSION_QUERY:
		"mutation InitSession($device: InitSessionInput!, $clientType: ClientType!) {" +
		"  initSession(device: $device, clientType: $clientType) {" +
		"    deviceId" +
		"    sessionId" +
		"    entitlements { code }" +
		"  }" +
		"}",

	INIT_PLAYBACK_SESSION_QUERY:
		"mutation InitPlaybackSession($mediaId: String!, $deviceId: String!, $sessionId: String!) {" +
		"  initPlaybackSession(mediaId: $mediaId, deviceId: $deviceId, sessionId: $sessionId) {" +
		"    playbackSessionId" +
		"    playback { url cdn token expiration }" +
		"    heartbeatInfo { url interval }" +
		"  }" +
		"}",

	// clientType: "WEB" is the confirmed-working value from live testing --
	// not a webOS-accurate clientType, but this API doesn't appear to gate
	// on device authenticity for it, and no webOS-specific value has been
	// discovered or is worth guessing at given "WEB" already works.
	buildInitSessionBody: function (deviceId) {
		return JSON.stringify({
			query: MLBMediaGateway.INIT_SESSION_QUERY,
			variables: {
				device: {
					appVersion: "1.0.1",
					deviceFamily: "tablet",
					knownDeviceId: deviceId,
					languagePreference: "ENGLISH",
					manufacturer: "HP",
					model: "TouchPad",
					os: "webOS",
					osVersion: "3.0.5"
				},
				clientType: "WEB"
			}
		});
	},

	buildInitPlaybackSessionBody: function (mediaId, deviceId, sessionId) {
		return JSON.stringify({
			query: MLBMediaGateway.INIT_PLAYBACK_SESSION_QUERY,
			variables: {
				mediaId: mediaId,
				deviceId: deviceId,
				sessionId: sessionId
			}
		});
	},

	// Returns { deviceId, sessionId, entitlements } or null (bad/expired
	// token, or a GraphQL error -- inspect json.errors when this is null).
	parseInitSessionResponse: function (json) {
		var session = json && json.data && json.data.initSession;
		if (!session || !session.sessionId) {
			return null;
		}
		return session;
	},

	// Returns { url, heartbeatUrl, heartbeatInterval } -- deliberately
	// drops playback.cdn/token: confirmed live that the plain playback.url
	// needs no extra auth at all, and that sending playback.token as a
	// header (x-cdn-token) actively breaks it with a 403. Don't reintroduce
	// that header without re-confirming against a live session first.
	parseInitPlaybackSessionResponse: function (json) {
		var result = json && json.data && json.data.initPlaybackSession;
		var playback = result && result.playback;
		if (!playback || !playback.url) {
			return null;
		}
		var heartbeat = result.heartbeatInfo || {};
		return {
			url: playback.url,
			heartbeatUrl: heartbeat.url || "",
			heartbeatInterval: heartbeat.interval || 60
		};
	}
};
