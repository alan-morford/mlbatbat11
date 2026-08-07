// Drop-in replacement for mlb.GenericWebView in mlb.NewsView's article pane
// (see views/NewsView.js's "articleWebView" component) -- same external
// contract (published params/title, show() method) so NewsView.js needed no
// changes beyond swapping that one component's kind.
//
// Why this exists: loading the live article page through Atlas's WPE engine
// (see views/GenericWebView.js) is too slow to be useful in practice. This
// instead fetches the raw article HTML via com.mlb.atbat2011.service's
// curl-backed httpRequest command (bypasses ESPN's Akamai block on this
// app's own WebKit XHR -- see the mlbatbat_espn_akamai_block project
// memory), runs it through lib/parsers/ArticleExtract.js (Mozilla
// Readability against a real in-app DOM, no jsdom/Node needed) to get clean
// {title, byline, content}, and renders that as plain DOM content -- no
// live page JS/ads/trackers, no Atlas WPE process at all.
//
// Deliberately NO live-webview/Atlas fallback of any kind (an earlier
// version had one -- removed per direct user feedback, 2026-08-07: Atlas
// hanging on a fallback load was the direct cause of a real on-device
// "too many cards" webOS memory error, since this view's own give-up
// timeout only stopped waiting on the UI side, it never actually tore down
// the underlying Atlas/BrowserPageWPE session). If extraction fails --
// non-article pages (ESPN video-clip/box-score pages, both seen in real
// News feed data, have no real article body to extract) or the fetch
// itself fails -- this shows a plain "no preview available" message
// instead. This view now never creates a "WebView"-kind component at all,
// so Atlas is never invoked from the News flow, full stop -- the global
// enyo.BasicWebView.prototype patch in views/GenericWebView.js still
// exists (still needed for that file's OWN top-level GenericWebView, used
// elsewhere in the app outside News), but a dormant patch with nothing
// left in this view to apply it to spawns no Atlas process.
enyo.kind({
	name : "mlb.ArticleReaderView",
	kind : "enyo.VFlexBox",
	flex : 1,
	published : {
		params : null,
		title : ""
	},
	components : [ {
		name : "readerHeader",
		kind : "mlb.GenericWebViewHeader",
		flex : 0
	}, {
		name : "readerScroller",
		kind : "enyo.Scroller",
		flex : 1,
		className : "articleReaderScroller",
		components : [ {
			name : "readerContent",
			kind : "enyo.HtmlContent",
			className : "fullArticleView",
			onLinkClick : "readerLinkClick"
		} ]
	}, {
		kind : "Toolbar",
		height : "40px",
		flex : 0,
		components : [ {
			kind : "GrabButton"
		} ]
	}, {
		name : "getArticleHtml",
		kind : "PalmService",
		service : "palm://com.mlb.atbat2011.service/",
		method : "httpRequest",
		onSuccess : "gotArticleHtml",
		onFailure : "articleHttpFailed"
	}, {
		// Official webOS mechanism for "open in whatever's the system
		// default handler" -- NOT tied to any specific browser app (Atlas,
		// stock browser, whatever). Same shape as the SDK's own documented
		// "download an html file and open the browser app" example.
		name : "openInBrowserCmd",
		kind : "PalmService",
		service : "palm://com.palm.applicationManager/",
		method : "open",
		onFailure : "openInBrowserFailed"
	} ],

	currentUrl : null,

	show : function() {
		this.$.readerHeader.$.title.setContent(this.title);
		this.currentUrl = this.params.url;
		this.$.readerContent.setContent("");
		main.showMiddleSpinner();
		SportsLogger.log("ArticleReader", "fetching " + this.currentUrl);
		this.$.getArticleHtml.call({ url : this.currentUrl, method : "GET", followRedirects : true });
	},

	gotArticleHtml : function(inSender, inResponse) {
		var status = inResponse && inResponse.status;
		var isSuccess = status === 0 || (status >= 200 && status < 300);
		var extracted = null;
		if (isSuccess && inResponse.raw) {
			try {
				extracted = ArticleExtract.extract(inResponse.raw, this.currentUrl);
			} catch (e) {
				console.log("ArticleReaderView: extract threw: " + e);
				extracted = null;
			}
		}
		main.hideMiddleSpinner();
		if (!extracted) {
			SportsLogger.log("ArticleReader", "extraction failed (status=" + status + ") for " + this.currentUrl);
			this.showNoPreview();
			return;
		}
		var html = "";
		if (extracted.title) {
			html += '<div class="articleTitle">' + enyo.string.escapeHtml(extracted.title) + "</div>";
		}
		if (extracted.byline) {
			html += '<div class="articleByLine">' + enyo.string.escapeHtml(extracted.byline) + "</div>";
		}
		html += '<div class="articleBody">' + extracted.content + "</div>";
		this.$.readerContent.setContent(html);
		this.$.readerScroller.scrollTo(0, 0);
		SportsLogger.log("ArticleReader", "extracted " + (extracted.content ? extracted.content.length : 0) + " chars for " + this.currentUrl);
	},

	articleHttpFailed : function(inSender, inResponse) {
		main.hideMiddleSpinner();
		SportsLogger.log("ArticleReader", "httpRequest failed for " + this.currentUrl + ": " + JSON.stringify(inResponse).substring(0, 300));
		this.showNoPreview();
	},

	showNoPreview : function() {
		this.$.readerContent.setContent(
			'<div class="articleTitle">No preview available</div>' +
			'<div class="articleBody">This link isn\'t a readable article (it may be a video or other page type not supported here).<br><br>' +
			'<a href="' + enyo.string.escapeHtml(this.currentUrl) + '">Open in Browser</a></div>'
		);
	},

	// Fires for the "Open in Browser" link above AND for any link tapped
	// INSIDE successfully-extracted article content (enyo.HtmlContent
	// intercepts every <a> tap and routes it through onLinkClick instead of
	// letting it navigate this control itself) -- same handler for both,
	// since the desired behavior is identical either way.
	readerLinkClick : function(inSender, inUrl) {
		SportsLogger.log("ArticleReader", "opening in system default browser: " + inUrl);
		this.$.openInBrowserCmd.call({ target : inUrl });
	},
	openInBrowserFailed : function(inSender, inResponse) {
		SportsLogger.log("ArticleReader", "openInBrowser failed: " + JSON.stringify(inResponse).substring(0, 300));
	}
});
