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

NewsParser.parseNewsFromJSON = function (json) {
	var rawArticles = (json && json.articles) || [];
	var articles = [];

	for (var i = 0; i < rawArticles.length; i++) {
		var article = rawArticles[i];
		var link = (article.links && article.links.web && article.links.web.href) || "";

		articles.push({
			title: article.headline || "",
			description: article.description || "",
			link: link,
			pubDate: article.published || ""
		});
	}

	return articles;
};
