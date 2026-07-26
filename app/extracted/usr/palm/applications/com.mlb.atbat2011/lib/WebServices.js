// Dead: gdx.mlb.com resolves (CloudFront) but every path returns S3
// AccessDenied -- the feed bucket behind it has been decommissioned.
// Confirmed by direct connectivity test; see ScoreboardStatsAPIService below
// for the live replacement used by views/ScoreboardView.js, and
// ScoreboardBroadcastsAPIService further down for the one used by
// views/AudioView.js (this kind is no longer referenced by either).
enyo.kind( {
	name : "ScoreboardService",
	kind : "MLBWebService",
	method : "GET",
	handleAs : "xml",
	urlTemplate:"http://gdx.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/scoreboard_palm.xml",
	cacheExpires: 15,
	envQA:{
		urlTemplate:"http://gd.qa.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/scoreboard_palm.xml"
	}

});

// Live replacement for ScoreboardService/master_scoreboard.json, used by
// views/ScoreboardView.js + lib/parsers/ScoreboardParser.js. MLB Stats API --
// undocumented but free, keyless, no observed rate limit; it's what MLB.com
// itself runs on. No QA/PROD split exists for this API, unlike the old feeds.
enyo.kind( {
	name : "ScoreboardStatsAPIService",
	kind : "MLBWebService",
	method : "GET",
	handleAs : "json",
	cacheExpires: 15,
	urlTemplate : "https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=team,linescore&date={$date}"
});

// Live replacement for ScoreboardService's game.audio.afeed list, used by
// views/AudioView.js + lib/parsers/BroadcastsParser.js. Same MLB Stats API
// endpoint as above with a different hydrate -- confirmed live (see project
// plan's Sub-phase A) that hydrate=broadcasts returns a broadcasts[] array
// per game with type ("AM"/"FM" = radio, "TV" = video), mediaId (a GUID,
// what lib/MLBMediaGateway.js's initPlaybackSession needs), and
// availableForStreaming. This call itself needs no auth -- only the
// playback session built from its mediaId does.
//
// hydrate=team is also required -- without it, games[].teams.{away,home}.team
// only has {id, name, link}, no `abbreviation` (confirmed live), which is
// what BroadcastsParser.js uses to label feed buttons. Omitting it produces
// blank-looking "- WMVP" style captions instead of "MIN - WMVP".
enyo.kind( {
	name : "ScoreboardBroadcastsAPIService",
	kind : "MLBWebService",
	method : "GET",
	handleAs : "json",
	cacheExpires: 15,
	urlTemplate : "https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=team,broadcasts&date={$date}"
});

// Dead: m.mlb.com's article-body feed depended on wapc.mlb.com's headline
// feed below for the cid used to build this URL, and that's gone. Left in
// place -- see NewsRSSService below for the live replacement (per user
// direction, ESPN's RSS feed, which has no per-article full-body fetch at
// all, so this one has no direct successor; views/NewsView.js now opens the
// RSS item's own link externally instead).
enyo.kind({
	name: "NewsArticleService",
	kind : "MLBWebService",
	method : "GET",
	handleAs : "xml",
	headers : null,
	urlTemplate: "http://m.mlb.com/gen/articles/{$yyyy}/{$mm}/{$dd}/{$id}.xml"
});

// Dead: wapc.mlb.com doesn't resolve in DNS at all.
enyo.kind({
	name: "NewsArticlesService",
	kind : "MLBWebService",
	cacheExpires: 15,
	urlTemplate : "http://wapc.mlb.com/gen/atbat/2011/{$teamcode}/news/headlines.xml",
	method : "GET",
	handleAs : "xml",
	headers : null,
	envQA:{
		urlTemplate:"http://wapqa.mlb.com/gen/atbat/2011/{$teamcode}/news/headlines.xml"
	}
});

// Live replacement for NewsArticleService/NewsArticlesService above, used by
// views/NewsView.js + lib/parsers/NewsParser.js. ESPN's undocumented site
// API, not their RSS feed (see lib/parsers/NewsParser.js's header comment
// for why RSS was dropped): this endpoint takes a real team= filter with
// exact server-side matching, unlike RSS's single unfiltered pool.
enyo.kind({
	name: "NewsJSONService",
	kind : "MLBWebService",
	cacheExpires: 15,
	urlTemplate : "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news?limit={$limit}&team={$team}",
	method : "GET",
	handleAs : "json",
	headers : null
});
// Dead, same as ScoreboardService above -- confirmed by direct connectivity
// test (gdx.mlb.com resolves, every path returns S3 AccessDenied).
// views/Main.js's gotConfig()/gotExtras() now fall back to
// data/localConfig.js/data/localExtras.js instead of relying on these.
enyo.kind({
	name: "ExtrasService",
	kind : "MLBWebService",
	urlTemplate : "http://gdx.mlb.com/components/game/mlb/mobile/atbat/palm/config/extras/json/{$version}",
	method : "GET",
	handleAs : "json",
	cacheExpires: 0, //no cache
	headers : null,
	envQA:{
		urlTemplate : "http://wapqa.mlb.com/atbat/palm/config/extras/json/{$version}"
	}
});
// Dead, same as ExtrasService above.
enyo.kind({
	name: "ConfigService",
	kind : "MLBWebService",
	urlTemplate : "http://gdx.mlb.com/components/game/mlb/mobile/atbat/palm/config/config/json/{$version}",
	method : "GET",
	handleAs : "json",
	cacheExpires: 0, //no cache
	headers : null,
	envQA:{
		urlTemplate : "http://wapqa.mlb.com/atbat/palm/config/config/json/{$version}"
	}
});
enyo.kind({
	name        : "VideoHighlightsService",
	kind        : "MLBWebService",
	urlTemplate : "http://gdx.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/gid_{$gid}/media/mobile.xml",
	method      : "GET",
	handleAs    : "xml",
	headers     : null,
	envQA:{
		urlTemplate : "http://gd.qa.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/gid_{$gid}/media/mobile.xml"
	}
});

// Live source for views/StandingsView.js + lib/parsers/StandingsParser.js.
// The original StandingsView had no service kind of its own to repoint --
// it was just a WebView embedding http://wap.mlb.com/atbat/palm/standings/
// (dead, DNS doesn't resolve), so this is new rather than a replacement.
enyo.kind( {
	name : "StandingsStatsAPIService",
	kind : "MLBWebService",
	method : "GET",
	handleAs : "json",
	cacheExpires: 15,
	urlTemplate : "https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season={$season}"
});

// Live source for views/GamedayView.js + lib/parsers/GamedayParser.js. The
// original GamedayView had no service kind either -- it embedded a remote
// MLB-hosted webpage (main.config.gamedayUrl.PROD/QA,
// wapc.mlb.com/gd3/apps/native/palm.jsp, dead), so this is new. v1.1 (not
// v1) is correct for this specific endpoint -- confirmed via harness against
// live data.
enyo.kind( {
	name : "GamedayStatsAPIService",
	kind : "MLBWebService",
	method : "GET",
	handleAs : "json",
	cacheExpires: 0, // always fetch fresh -- score/plays change during a live game
	urlTemplate : "https://statsapi.mlb.com/api/v1.1/game/{$gamePk}/feed/live"
});
