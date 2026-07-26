// One-off diagnostic tool: runs the full Okta -> initSession ->
// initPlaybackSession chain, fetches a real archived game's radio
// broadcast, and concatenates the first N segments (raw ADTS AAC frames,
// safe to concatenate directly) into a single playable .aac file. Not part
// of the automated harness suite -- run directly with `node
// harness/tools/downloadArchivedClip.js`. Never logs credentials or
// session tokens.
const fs = require("fs");
const path = require("path");
const { loadEnvLocal } = require("../loadEnv");
const { fetchOktaToken } = require("../oktaAuth");

loadEnvLocal();

const GRAPHQL_URL = "https://media-gateway.mlb.com/graphql";
// KMOX 1120 AM, Cardinals @ Cubs, 2024-06-15 -- confirmed live via
// statsapi.mlb.com/api/v1/schedule?hydrate=broadcasts, availableForStreaming:true.
const MEDIA_ID = "439f49f6-c932-43ae-9516-4e725a6d5f9f";
const SEGMENT_COUNT = 45; // ~3 minutes at ~4s/segment
const OUTPUT_PATH = path.join(__dirname, "..", "..", "test-clips", "kmox-sample.aac");

async function gql(accessToken, query, variables) {
	const res = await fetch(GRAPHQL_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", "Authorization": "Bearer " + accessToken },
		body: JSON.stringify({ query: query, variables: variables })
	});
	return res.json();
}

async function main() {
	const username = process.env.MLB_USERNAME;
	const password = process.env.MLB_PASSWORD;
	if (!username || !password) {
		console.log("MLB_USERNAME/MLB_PASSWORD not set in harness/.env.local -- aborting");
		process.exit(1);
	}

	console.log("Logging in...");
	const token = await fetchOktaToken(username, password);

	console.log("Starting session...");
	const sessionQuery = `
		mutation InitSession($device: InitSessionInput!, $clientType: ClientType!) {
			initSession(device: $device, clientType: $clientType) { deviceId sessionId }
		}
	`;
	const deviceVars = {
		device: {
			appVersion: "1.0", deviceFamily: "desktop", knownDeviceId: "mlbatbat-harness",
			languagePreference: "ENGLISH", manufacturer: "generic", model: "generic",
			os: "linux", osVersion: "1.0"
		},
		clientType: "WEB"
	};
	const sessionJson = await gql(token.accessToken, sessionQuery, deviceVars);
	const session = sessionJson.data && sessionJson.data.initSession;
	if (!session) {
		console.log("initSession failed:", JSON.stringify(sessionJson.errors));
		process.exit(1);
	}

	console.log("Requesting playback session for KMOX broadcast...");
	const playQuery = `
		mutation InitPlaybackSession($mediaId: String!, $deviceId: String!, $sessionId: String!) {
			initPlaybackSession(mediaId: $mediaId, deviceId: $deviceId, sessionId: $sessionId) {
				playback { url }
			}
		}
	`;
	const playJson = await gql(token.accessToken, playQuery, {
		mediaId: MEDIA_ID, deviceId: session.deviceId, sessionId: session.sessionId
	});
	const masterUrl = playJson.data && playJson.data.initPlaybackSession && playJson.data.initPlaybackSession.playback.url;
	if (!masterUrl) {
		console.log("initPlaybackSession failed:", JSON.stringify(playJson.errors));
		process.exit(1);
	}

	console.log("Fetching master playlist...");
	const masterText = await (await fetch(masterUrl)).text();
	const masterLines = masterText.split("\n").map((l) => l.trim()).filter((l) => l.length);
	let variantLine = null;
	for (let i = 0; i < masterLines.length; i++) {
		if (masterLines[i].indexOf("#EXT-X-STREAM-INF") === 0) {
			variantLine = masterLines[i + 1];
			break;
		}
	}
	if (!variantLine) {
		console.log("No variant found in master playlist");
		process.exit(1);
	}
	const variantUrl = new URL(variantLine, masterUrl).toString();

	console.log("Fetching media playlist...");
	const variantText = await (await fetch(variantUrl)).text();
	const segmentPaths = variantText
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length && l.charAt(0) !== "#");

	const toFetch = segmentPaths.slice(0, SEGMENT_COUNT);
	console.log(`Downloading ${toFetch.length} of ${segmentPaths.length} total segments (~${(toFetch.length * 4 / 60).toFixed(1)} min)...`);

	const chunks = [];
	for (let i = 0; i < toFetch.length; i++) {
		const segUrl = new URL(toFetch[i], variantUrl).toString();
		const res = await fetch(segUrl);
		if (res.status !== 200) {
			console.log(`  segment ${i} failed: HTTP ${res.status}`);
			continue;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		chunks.push(buf);
		process.stdout.write(".");
	}
	console.log("");

	fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
	fs.writeFileSync(OUTPUT_PATH, Buffer.concat(chunks));
	console.log(`Wrote ${chunks.length} segments (${(Buffer.concat(chunks).length / 1024).toFixed(0)} KB) to:`);
	console.log(OUTPUT_PATH);
}

main().catch((e) => {
	console.log("Error:", e.message);
	process.exit(1);
});
