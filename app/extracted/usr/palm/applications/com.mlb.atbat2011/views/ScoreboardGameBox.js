// One game tile in the native Scoreboard grid. Deliberately plain
// (non-flexbox) Enyo controls with float-based CSS internally -- nesting
// Enyo's VFlexBox/HFlexBox (-webkit-box flex model) inside the outer
// float:left tile grid caused inconsistent row wrapping on-device (tiles
// wrapping 4/2/4/1/4/1 per row instead of a consistent 3 per row), so this
// avoids Enyo's flex kinds entirely here, matching the rest of this app's
// float-based 2011 CSS instead. Team logos are PNGs from ESPN's CDN
// (a.espncdn.com/i/teamlogos/mlb/500/{slug}.png), not MLB's own
// mlbstatic.com SVGs -- SVG-as-<img> rendering support on webOS 3.0.5's
// WebKit was unconfirmed and turned out not to work; PNG has no such risk.
//
// Logos never change per team (only which teams appear on a given day's
// slate does), so every fetched logo is cached forever as a data: URI in
// TheCache (localStorage) keyed by slug -- see cachedTeamLogoDataUri/
// fetchAndCacheTeamLogo below. Once cached, a tile's <img> src is set
// directly from localStorage with zero network access; only ever-changing
// game DATA (score/inning/status) still hits the network on every refresh,
// not these fixed, tiny (a few KB) icons. Binary-safe XHR read via the
// classic "charset=x-user-defined" trick (no ArrayBuffer/Blob support to
// rely on in this WebKit) + btoa(), same era-appropriate pattern as the rest
// of this codebase's old-WebKit workarounds.
var TEAM_LOGO_CACHE_PREFIX = "teamLogoDataUri_";

function cachedTeamLogoDataUri(slug) {
	var cached = TheCache.get(TEAM_LOGO_CACHE_PREFIX + slug);
	return (cached && cached.value) ? cached.value : null;
}

function fetchAndCacheTeamLogo(slug, url, onReady) {
	var xhr = new XMLHttpRequest();
	try {
		xhr.open("GET", url, true);
		xhr.overrideMimeType("text/plain; charset=x-user-defined");
		xhr.onreadystatechange = function() {
			if (xhr.readyState !== 4) {
				return;
			}
			if (xhr.status !== 200 && xhr.status !== 0) {
				return; // leave the tile showing the direct remote URL
			}
			try {
				var text = xhr.responseText, binary = "";
				for (var i = 0; i < text.length; i++) {
					binary += String.fromCharCode(text.charCodeAt(i) & 0xff);
				}
				var dataUri = "data:image/png;base64," + btoa(binary);
				TheCache.put(TEAM_LOGO_CACHE_PREFIX + slug, dataUri, -1);
				onReady(dataUri);
			} catch (e) {
				console.log("team logo cache encode failed for " + slug + ": " + e);
			}
		};
		xhr.send(null);
	} catch (e) {
		console.log("team logo fetch failed for " + slug + ": " + e);
	}
}

enyo.kind({
	name : "mlb.ScoreboardGameBox",
	kind : "enyo.Control",
	className : "scoreboardGameBox",
	published : {
		game : null
	},
	components : [
		{
			className : "scoreboardGameBoxRow",
			components : [
				{ name : "awayLogo", kind : "Image", className : "scoreboardTeamLogo" },
				{ name : "awayTeam", className : "scoreboardTeamName" },
				{ name : "awayScore", className : "scoreboardTeamScore" }
			]
		},
		{
			className : "scoreboardGameBoxRow",
			components : [
				{ name : "homeLogo", kind : "Image", className : "scoreboardTeamLogo" },
				{ name : "homeTeam", className : "scoreboardTeamName" },
				{ name : "homeScore", className : "scoreboardTeamScore" }
			]
		},
		{ name : "statusLine", className : "scoreboardGameStatus" }
	],
	setGame : function(game) {
		this.game = game;
		if (!game) {
			return;
		}

		this.$.awayTeam.setContent(game.awayTeam.name);
		this.$.homeTeam.setContent(game.homeTeam.name);
		this.setLogo(this.$.awayLogo, game.awayTeam.abbreviation);
		this.setLogo(this.$.homeLogo, game.homeTeam.abbreviation);

		this.$.awayScore.setContent(this.formatScore(game.awayTeam.score));
		this.$.homeScore.setContent(this.formatScore(game.homeTeam.score));

		this.$.statusLine.setContent(this.getStatusText(game));
	},
	// Stats API's own abbreviation matches ESPN's logo slug for every team
	// except Arizona (Stats API "AZ" 404s on ESPN's CDN; ESPN uses "ari") --
	// see data/MLBTeamReference.js, which is generated fresh from Stats API
	// and cross-checked against every ESPN logo slug. Not routed through
	// that file's lookup here to avoid a data/ dependency in this view for
	// a single hardcoded exception.
	getLogoUrl : function(abbreviation) {
		var slug = (abbreviation === "AZ") ? "ari" : (abbreviation || "").toLowerCase();
		return "https://a.espncdn.com/i/teamlogos/mlb/500/" + slug + ".png";
	},
	// Cache-first: a cached logo sets the <img> src straight from
	// localStorage, no network at all. Uncached (first time ever this team's
	// logo is needed, or cache was cleared) shows the real remote URL right
	// away so the tile isn't blank, then swaps to the freshly-cached data URI
	// once the background fetch completes -- every load after that is free.
	setLogo : function(imgControl, abbreviation) {
		var slug = (abbreviation === "AZ") ? "ari" : (abbreviation || "").toLowerCase();
		var cached = cachedTeamLogoDataUri(slug);
		if (cached) {
			imgControl.setSrc(cached);
			return;
		}
		var url = this.getLogoUrl(abbreviation);
		imgControl.setSrc(url);
		fetchAndCacheTeamLogo(slug, url, function(dataUri) {
			// The tile may have been destroyed/recycled (scoreboard refreshed
			// again) by the time this async fetch completes -- guard against
			// setting src on a dead control.
			if (imgControl.hasNode && imgControl.hasNode()) {
				imgControl.setSrc(dataUri);
			}
		});
	},
	formatScore : function(score) {
		// Stats API omits the score field entirely for games that haven't
		// started -- guard on the value itself, not just game.status.isPreview,
		// since not every not-yet-scored state is reliably "Preview"
		// (postponed/suspended/delayed games can land here too).
		return (typeof score === "number") ? String(score) : "";
	},
	getStatusText : function(game) {
		if (game.status.isFinal) {
			return "Final";
		}
		if (game.status.isLive) {
			var state = game.inningState ? game.inningState + " " : "";
			return state + (game.inning || "");
		}
		return game.status.detailedState || "";
	}
});
