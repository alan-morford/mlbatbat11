const test = require("node:test");
const assert = require("node:assert/strict");
const { loadEnvLocal } = require("../loadEnv");
const { fetchOktaToken } = require("../oktaAuth");

loadEnvLocal();

const GRAPHQL_URL = "https://media-gateway.mlb.com/graphql";

// The exact initSession/initPlaybackSession mutation shapes below started as
// a best-effort reconstruction (from a summary of a third-party MLB.TV
// client project, never independently confirmed against the real API) --
// unlike every other endpoint used in this project, this one had NOT been
// verified live before this session. initSession is now confirmed working
// live; initPlaybackSession is still being narrowed down the same way.
// Assertions stay lenient: this file is written to be diagnostic on a wrong
// guess, not just pass/fail. GraphQL error messages are safe to print (they
// describe schema shape, not secrets) and are the main signal when a
// mutation needs adjusting.
async function graphqlRequest(accessToken, query, variables) {
	const res = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": "Bearer " + accessToken
		},
		body: JSON.stringify({ query: query, variables: variables })
	});

	const json = await res.json().catch(() => null);
	return { status: res.status, json: json };
}

const INIT_SESSION_QUERY = `
	mutation InitSession($device: InitSessionInput!, $clientType: ClientType!) {
		initSession(device: $device, clientType: $clientType) {
			deviceId
			sessionId
			entitlements {
				code
			}
		}
	}
`;

function deviceVariables() {
	return {
		device: {
			appVersion: "1.0",
			deviceFamily: "desktop",
			knownDeviceId: "mlbatbat-harness",
			languagePreference: "ENGLISH",
			manufacturer: "generic",
			model: "generic",
			os: "linux",
			osVersion: "1.0"
		},
		clientType: "WEB"
	};
}

test("media-gateway GraphQL: initSession", async (t) => {
	const username = process.env.MLB_USERNAME;
	const password = process.env.MLB_PASSWORD;

	if (!username || !password) {
		t.skip("MLB_USERNAME/MLB_PASSWORD not set in harness/.env.local -- skipping");
		return;
	}

	const token = await fetchOktaToken(username, password);
	const { status, json } = await graphqlRequest(token.accessToken, INIT_SESSION_QUERY, deviceVariables());

	console.log(`initSession: HTTP ${status}`);
	if (json && json.errors) {
		console.log("GraphQL errors (safe to show -- describes schema, not secrets):");
		for (const err of json.errors) {
			console.log("  - " + err.message);
		}
	}
	if (json && json.data && json.data.initSession) {
		const session = json.data.initSession;
		console.log(`initSession succeeded: sessionId present=${!!session.sessionId}, entitlements=${JSON.stringify(session.entitlements)}`);
		assert.ok(session.sessionId, "expected a sessionId on success");
	} else {
		console.log("initSession did not return usable data -- mutation shape likely needs adjustment based on the errors above.");
	}

	assert.ok(json !== null, "expected a parseable JSON response from the GraphQL endpoint");
});

test("media-gateway GraphQL: initPlaybackSession for a real radio broadcast", async (t) => {
	const username = process.env.MLB_USERNAME;
	const password = process.env.MLB_PASSWORD;

	if (!username || !password) {
		t.skip("MLB_USERNAME/MLB_PASSWORD not set in harness/.env.local -- skipping");
		return;
	}

	// A known completed game (2024-06-15, Cardinals @ Cubs) with a real,
	// availableForStreaming:true AM radio broadcast -- confirmed live via
	// statsapi.mlb.com/api/v1/schedule?hydrate=broadcasts.
	const KMOX_MEDIA_ID = "439f49f6-c932-43ae-9516-4e725a6d5f9f";

	const token = await fetchOktaToken(username, password);
	const sessionRes = await graphqlRequest(token.accessToken, INIT_SESSION_QUERY, deviceVariables());
	const session = sessionRes.json && sessionRes.json.data && sessionRes.json.data.initSession;

	if (!session || !session.sessionId) {
		t.skip("initSession did not succeed -- run that test first and fix the mutation shape");
		return;
	}

	const query = `
		mutation InitPlaybackSession($mediaId: String!, $deviceId: String!, $sessionId: String!) {
			initPlaybackSession(mediaId: $mediaId, deviceId: $deviceId, sessionId: $sessionId) {
				playbackSessionId
				playback {
					url
					cdn
					token
					expiration
				}
				heartbeatInfo {
					url
					interval
				}
			}
		}
	`;
	const variables = {
		mediaId: KMOX_MEDIA_ID,
		deviceId: session.deviceId,
		sessionId: session.sessionId
	};

	const { status, json } = await graphqlRequest(token.accessToken, query, variables);

	console.log(`initPlaybackSession: HTTP ${status}`);
	if (json && json.errors) {
		console.log("GraphQL errors (safe to show -- describes schema, not secrets):");
		for (const err of json.errors) {
			console.log("  - " + err.message);
		}
	}

	const result = json && json.data && json.data.initPlaybackSession;
	const playback = result && result.playback;
	if (playback && playback.url) {
		console.log(`initPlaybackSession succeeded: playbackSessionId present=${!!result.playbackSessionId}, cdn=${playback.cdn}, expiration=${playback.expiration}, cdn token present=${!!playback.token}`);
		console.log(`heartbeatInfo: interval=${result.heartbeatInfo && result.heartbeatInfo.interval}s, url present=${!!(result.heartbeatInfo && result.heartbeatInfo.url)}`);

		// Fetch the playlist itself to inspect its shape -- the URL/token are
		// session-scoped secrets, so don't print them verbatim.
		const playlistRes = await fetch(playback.url, {
			headers: playback.token ? { "x-cdn-token": playback.token } : {}
		});
		const playlistText = await playlistRes.text();
		console.log(`Playlist fetch: HTTP ${playlistRes.status}, ${playlistText.length} bytes`);
		console.log(`Is master playlist (#EXT-X-STREAM-INF present): ${playlistText.indexOf("#EXT-X-STREAM-INF") >= 0}`);
		console.log(`Is media playlist (#EXTINF present): ${playlistText.indexOf("#EXTINF") >= 0}`);
		console.log(`AES-128 encrypted (#EXT-X-KEY present): ${playlistText.indexOf("#EXT-X-KEY") >= 0}`);
		const targetDurationMatch = playlistText.match(/#EXT-X-TARGETDURATION:(\d+)/);
		console.log(`Target duration: ${targetDurationMatch ? targetDurationMatch[1] + "s" : "not found (likely a master playlist -- may need to follow a variant)"}`);
		// Strip query strings (may carry session tokens) before printing structure.
		const sanitized = playlistText.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, "$1?<redacted>");
		console.log("Playlist structure (query strings redacted):\n" + sanitized.slice(0, 1500));
	} else {
		console.log("initPlaybackSession did not return a usable playback.url -- mutation shape likely needs adjustment based on the errors above.");
	}

	assert.ok(json !== null, "expected a parseable JSON response from the GraphQL endpoint");
});
