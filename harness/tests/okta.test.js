const test = require("node:test");
const assert = require("node:assert/strict");
const { loadEnvLocal } = require("../loadEnv");
const { fetchOktaToken } = require("../oktaAuth");

loadEnvLocal();

// Credentials come ONLY from harness/.env.local (gitignored), created by you
// directly in a text editor outside any agent tool call. This test never
// logs process.env.MLB_USERNAME/MLB_PASSWORD, the raw token response body,
// or the access/refresh token values themselves -- only HTTP status and
// which expected fields are present/absent.
test("Okta ROPC token exchange succeeds with real MLB.TV credentials", async (t) => {
	const username = process.env.MLB_USERNAME;
	const password = process.env.MLB_PASSWORD;

	if (!username || !password) {
		t.skip("MLB_USERNAME/MLB_PASSWORD not set in harness/.env.local -- skipping");
		return;
	}

	const token = await fetchOktaToken(username, password);

	assert.equal(typeof token.accessToken, "string", "expected an access_token string");
	assert.ok(token.accessToken.length > 0, "access_token should be non-empty");
	assert.equal(typeof token.expiresIn, "number", "expected a numeric expires_in");

	console.log(`Okta token exchange: access_token present (length ${token.accessToken.length}), expires_in=${token.expiresIn}s`);
});
