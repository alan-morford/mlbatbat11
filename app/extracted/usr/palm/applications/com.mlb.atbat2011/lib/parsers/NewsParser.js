// Parses ESPN's undocumented site API news endpoint
// (site.api.espn.com/apis/site/v2/sports/baseball/mlb/news) into a flat
// article list. Superseded the RSS feed (espn.com/espn/rss/mlb/news)
// originally used here: RSS is one shared "top headlines" pool of ~17 items
// across all 30 teams with no per-team filter, which made per-team coverage
// unreliable (most teams had zero articles on a given day) and required
// fuzzy client-side name matching that missed articles using nicknames RSS
// didn't reflect (e.g. "O's" for the Orioles). This endpoint takes a
// team=<espnSlug> query param with EXACT server-side filtering (each
// article is tagged with real team IDs in its categories[]), and reaches
// back ~12 days for a single team's articles, comfortably covering a
// ~10-articles-per-team target. See lib/WebServices.js's NewsJSONService
// and data/MLBTeamReference.js for the team-slug lookup.
//
// Still no full article body in the response -- views/NewsView.js opens the
// article's own link in-app via mlb.GenericWebView rather than rendering one.
var NewsParser = {};

// ESPN's video-clip pages (espn.com/video/clip/...) have no real article
// body -- confirmed live, see mlbatbat_readability_reader_mode: Readability
// correctly rejects them (well under its/our minimum content length), so
// views/ArticleReaderView.js was already falling back to a plain "No
// preview available" message for every one of these. Filtering them out of
// the list entirely (rather than showing them and letting the tap fail) is
// the better UX -- the reader was never going to work for these anyway.
NewsParser.VIDEO_LINK_RE = /^https?:\/\/(www\.)?espn\.com\/video\//i;

// ESPN's "2026 MLB ABS challenge system tracker" article (id 48305211) is a
// single living/pinned page that gets edited in place rather than a normal
// dated article -- confirmed live: it mentions every team, so it matches
// every team filter, and its lastModified keeps jumping to "now" on every
// edit, which puts it at the top of literally every listing. Filtered out
// here; views/NewsView.js's ABS_STATS_CATEGORY gives it its own dedicated
// entry in the team-picker list instead (single article, not a listing).
// ID-based, not URL-based -- the URL slug could change (it did rev from a
// generic slug to "team-player-rankings" between sessions), the numeric id
// has stayed stable.
NewsParser.PINNED_ARTICLE_ID = 48305211;
NewsParser.PINNED_ARTICLE_URL = "https://www.espn.com/mlb/story/_/id/48305211/2026-mlb-abs-challenge-system-tracker-team-player-rankings";
NewsParser.PINNED_ARTICLE_TITLE = "2026 MLB ABS Challenge System Tracker";

NewsParser.parseNewsFromJSON = function (json) {
	var rawArticles = (json && json.articles) || [];
	var articles = [];

	for (var i = 0; i < rawArticles.length; i++) {
		var article = rawArticles[i];
		var link = (article.links && article.links.web && article.links.web.href) || "";
		if (NewsParser.VIDEO_LINK_RE.test(link) || article.id === NewsParser.PINNED_ARTICLE_ID) {
			continue;
		}

		articles.push({
			title: article.headline || "",
			description: article.description || "",
			link: link,
			pubDate: article.published || ""
		});
	}

	return articles;
};
