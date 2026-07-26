// This is now the app's ONLY source for main.config -- ConfigService
// (gdx.mlb.com) is permanently dead (confirmed: domain resolves via
// CloudFront but every path returns S3 AccessDenied, the feed bucket is
// decommissioned), so views/Main.js's gotConfig() always falls back to this
// file rather than a live fetch. The date bounds below are intentionally
// generous (not pinned to one season) so this doesn't go stale every year --
// see lib/parsers/ScoreboardParser.js/views/ScoreboardView.js for the live
// per-date data, which comes from MLB Stats API, not from this file.
var localConfig = {
  "season":2011
  ,"firstAllowedDay":[2015,1,1]
  ,"lastAllowedDay":[2035,12,31]
  ,"suggestedDay":[2015,1,1]
  ,"openingDay":[2015,1,1]
  ,"videoPlaybackScenarios":{
    "high":"FLASH_1200K_640X360",
    "low":"FLASH_1200K_640X360",
	"condensedGames":{
		"high" : "FLASH_1200K_640X360",
		"low" : "FLASH_1200K_640X360"
	}
  }
  ,"audioPlaybackScenarios":{
    "high":"AUDIO_SHOUTCAST_32K",
    "low":"AUDIO_SHOUTCAST_32K" 
  }
  ,"audio": {
    "platform":"PALM",
    "sku": "PALMATBAT2011"
  }
  ,"gamedayUrl": {
    "PROD":"http://wapc.mlb.com/gd3/apps/native/palm.jsp?cacheId=20110727",
    "QA":"http://wapqa.mlb.com/gd3/apps/native/palm.jsp?cacheId=20110727"
  },
	"scoreboardUrls":{
		"template" : {
			"PROD" : "http://wapc.mlb.com/webos/scoreboard_tpl.html",
			"QA" : "http://wapqa.mlb.com/webos/scoreboard_tpl.html"
		},
		"data": {
			"PROD" : "http://wapc.mlb.com/gdcross/components/game/mlb/year_{$YYYY}/month_{$MM}/day_{$DD}/master_scoreboard.json",
			"QA" : "http://wapqa.mlb.com/gdcross/components/game/mlb/year_{$YYYY}/month_{$MM}/day_{$DD}/master_scoreboard.json"
		}
	}
};


