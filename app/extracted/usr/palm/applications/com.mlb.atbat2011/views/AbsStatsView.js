// Top-level left-nav entry (see data/localExtras.js's leftnav and
// views/Panels2.js's "panes"/leftNav.itemClicked) that jumps straight to
// the "2026 MLB ABS challenge system tracker" pinned article -- see
// lib/parsers/NewsParser.js's PINNED_ARTICLE_* for why this article gets
// its own entry instead of living in the normal per-team News listings (it
// mentions every team and is edited in place rather than dated, so it was
// floating to the top of every single team's list).
//
// Just a trivial subclass of mlb.ArticleReaderView (views/ArticleReaderView.js)
// that hardcodes its own title/params rather than expecting them from the
// generic leftNav.itemClicked plumbing (that plumbing only forwards
// item.properties.title for the "GenericWebView" view specifically -- easier
// to bypass that special-casing entirely than extend it for one more view).
enyo.kind({
	name : "mlb.AbsStatsView",
	kind : "mlb.ArticleReaderView",
	show : function() {
		this.title = NewsParser.PINNED_ARTICLE_TITLE;
		this.params = { url : NewsParser.PINNED_ARTICLE_URL };
		this.inherited(arguments);
	}
});
