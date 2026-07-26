// Okta ROPC (Resource Owner Password Credentials) token exchange for a real
// MLB.com account -- required because MLB's live radio playback (see
// lib/MLBMediaGateway.js, lib/AudioFlow.js) sits behind the same account
// system as MLB.TV, unlike the old dead identityPoint/SOAP flow this
// replaces (which only ever registered an anonymous per-device identity,
// no real login). ROPC has no browser redirect, so this is just a plain
// username/password POST -- see views/AudioView.js for the login form that
// collects them (typed by the device's actual user; never hardcoded or
// logged here).
//
// Endpoint, client_id, and request/response shape confirmed live against
// this project's Okta tenant this session (see the project plan's Sub-phase
// A notes) via harness/tests/okta.test.js, run against real credentials the
// user supplied in a gitignored .env.local -- never typed into or logged by
// that harness.
//
// NOT called via this app's own WebKit networking (no enyo.WebService kind
// here) -- confirmed live that MLB's Okta tenant refuses the password
// grant when the request looks like it came from a browser (a real Okta
// error, `error=unauthorized_client, error_description=Browser requests to
// the token endpoint may only use the authorization_code grant_type.`).
// The request is instead sent via com.mlb.atbat2011.service's generic
// curl-backed `httpRequest` command (see lib/AudioFlow.js's login()/
// flowSteps.login, and that service's MLBAudioService.js for the command
// itself) -- this object only builds the request body and parses the
// response, transport-agnostic.
var MLBAuth = {
	TOKEN_URL: "https://ids.mlb.com/oauth2/aus1m088yK07noBfh356/v1/token",
	CLIENT_ID: "0oa3e1nutA1HLzAKG356",
	TOKEN_CACHE_KEY: "mlb_okta_access_token",
	REFRESH_TOKEN_CACHE_KEY: "mlb_okta_refresh_token",

	buildTokenRequestBody: function (username, password) {
		return "grant_type=password"
			+ "&client_id=" + encodeURIComponent(MLBAuth.CLIENT_ID)
			+ "&scope=" + encodeURIComponent("openid offline_access")
			+ "&username=" + encodeURIComponent(username)
			+ "&password=" + encodeURIComponent(password);
	},

	// offline_access (requested above) is what makes Okta include a
	// refresh_token alongside the access token -- see parseTokenResponse.
	buildRefreshTokenRequestBody: function (refreshToken) {
		return "grant_type=refresh_token"
			+ "&client_id=" + encodeURIComponent(MLBAuth.CLIENT_ID)
			+ "&scope=" + encodeURIComponent("openid offline_access")
			+ "&refresh_token=" + encodeURIComponent(refreshToken);
	},

	// { access_token, expires_in, refresh_token } -> { accessToken,
	// expiresIn, refreshToken } or null if the response doesn't look like a
	// token (Okta returns an OAuth error body with the same 200/JSON shape
	// on bad credentials/an expired refresh token, no access_token).
	parseTokenResponse: function (json) {
		if (!json || !json.access_token) {
			return null;
		}
		return {
			accessToken: json.access_token,
			expiresIn: json.expires_in || 3600,
			refreshToken: json.refresh_token || null
		};
	},

	// TheCache here is lib/LocalStorageCache.js's synchronous, localStorage-
	// backed implementation (get/put/clear, no callbacks) -- NOT the DB8-
	// backed async singleton in lib/Cache.js, which looks superficially
	// similar (same global name, same put/get/clear method names) but is
	// dead code never loaded by depends.js. Confirmed by checking
	// depends.js directly and by views/Main.js's own synchronous
	// `TheCache.get("acceptedTerm") != null` usage for Terms acceptance --
	// don't reintroduce callback args here, they'd just be silently ignored.

	// Cached with a 5-minute safety margin off the real expiry so a token
	// already mid-expiry doesn't get handed to a fresh initSession call.
	cacheToken: function (accessToken, expiresIn) {
		TheCache.put(MLBAuth.TOKEN_CACHE_KEY, accessToken, Math.max(60, expiresIn - 300));
	},

	// Returns the cached access token, or null if nothing's cached / it's expired.
	getCachedToken: function () {
		var item = TheCache.get(MLBAuth.TOKEN_CACHE_KEY);
		return item ? item.value : null;
	},

	clearCachedToken: function () {
		TheCache.clear(MLBAuth.TOKEN_CACHE_KEY);
	},

	// Refresh tokens aren't time-boxed client-side the way access tokens
	// are -- cached with TheCache's -1 "never expire" sentinel (confirmed
	// in lib/LocalStorageCache.js: TheCache.get treats expires=="-1" as
	// always-valid) rather than guessing Okta's actual server-side
	// refresh-token lifetime for this tenant. Okta's own rejection of a
	// stale/revoked refresh token (handled by the caller falling back to
	// the password form) is the real signal, not a client-side timer.
	cacheRefreshToken: function (refreshToken) {
		if (!refreshToken) {
			return;
		}
		TheCache.put(MLBAuth.REFRESH_TOKEN_CACHE_KEY, refreshToken, -1);
	},

	getCachedRefreshToken: function () {
		var item = TheCache.get(MLBAuth.REFRESH_TOKEN_CACHE_KEY);
		return item ? item.value : null;
	},

	clearCachedRefreshToken: function () {
		TheCache.clear(MLBAuth.REFRESH_TOKEN_CACHE_KEY);
	}
};
