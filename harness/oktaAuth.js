// Shared Okta ROPC (Resource Owner Password Credentials) token-fetch helper
// for harness tests. Never logs credentials or the raw response body --
// callers get back only {accessToken, expiresIn} or a thrown Error with no
// secret material in its message.
const TOKEN_URL = "https://ids.mlb.com/oauth2/aus1m088yK07noBfh356/v1/token";
const CLIENT_ID = "0oa3e1nutA1HLzAKG356";

async function fetchOktaToken(username, password) {
	const body = new URLSearchParams({
		grant_type: "password",
		client_id: CLIENT_ID,
		scope: "openid offline_access",
		username: username,
		password: password
	});

	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString()
	});

	if (res.status !== 200) {
		throw new Error(`Okta token request failed with HTTP ${res.status}`);
	}

	const json = await res.json();
	if (typeof json.access_token !== "string" || !json.access_token) {
		throw new Error("Okta token response missing access_token");
	}

	return { accessToken: json.access_token, expiresIn: json.expires_in };
}

module.exports = { fetchOktaToken, TOKEN_URL, CLIENT_ID };
