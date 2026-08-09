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
	// Anchor for fullScreenOverlay's position:absolute below -- it needs to
	// cover this entire view, not just whatever ancestor happens to be
	// position:relative further up the tree.
	className : "articleReaderView",
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
		// Full-screen image viewer -- shown/hidden in place (position:
		// absolute over the whole view, see .articleFullScreenOverlay)
		// rather than a separate pane/SlidingPane pane, since it's a
		// same-article detail popup, not real navigation. Tapping the
		// featured image thumbnail below routes here via readerLinkClick's
		// "abt-fullscreen-image:" scheme -- reusing enyo.HtmlContent's
		// existing onLinkClick tap-interception instead of inventing a new
		// tap mechanism on this old WebKit for the thumbnail itself.
		name : "fullScreenOverlay",
		kind : "enyo.VFlexBox",
		className : "articleFullScreenOverlay",
		showing : false,
		components : [ {
			className : "articleFullScreenClose",
			// Plain ASCII, not a Unicode "X"-mark -- confirmed live this old
			// WebKit's default font has no glyph for that character,
			// rendering as a visible tofu/notdef box right before the word
			// "Close" instead of an X.
			content : "Close",
			onclick : "closeFullScreenImage"
		}, {
			kind : "enyo.VFlexBox",
			flex : 1,
			pack : "center",
			align : "center",
			components : [ {
				name : "fullScreenImg",
				kind : "Image",
				className : "articleFullScreenImg"
			}, {
				name : "fullScreenCaption",
				className : "articleFullScreenCaption"
			} ]
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
	currentImageUrl : null,
	currentImageCaption : "",

	show : function() {
		this.$.readerHeader.$.title.setContent(this.title);
		this.currentUrl = this.params.url;
		this.currentImageUrl = null;
		this.currentImageCaption = "";
		this.$.readerContent.setContent("");
		this.$.fullScreenOverlay.hide(); // reset -- a prior article's zoomed image shouldn't carry over
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
		// No title div here -- this.$.header (mlb.GenericWebViewHeader)
		// already shows it at the top of the pane (see show() above,
		// this.$.header.$.title.setContent(this.title)), so a second copy
		// in the body was pure duplication. extracted.title is still used
		// on the "no preview" fallback path (showNoPreview), unaffected.
		var html = "";
		// Featured/hero image (lib/parsers/ArticleExtract.js's own
		// og:image/twitter:image lookup -- Readability's extraction never
		// surfaces this itself, since it only pulls the article body, not
		// header/hero markup). Floated (see css/NewsView.css's
		// .articleFeaturedImage) so body text wraps to its left, then
		// continues below once the image's height clears.
		//
		// Rendered as a fixed-aspect-ratio background-image DIV, not a plain
		// <img> -- every article's source photo has its own native
		// dimensions, and the goal (per direct user feedback) is every
		// article's thumbnail rendering at the SAME dimensions regardless.
		// background-size:cover crops to fill a fixed 1:1 box (the aspect
		// ratio of a real reference article's og:image, confirmed live via
		// ESPN's own og:image:width/height meta tags: 500x500) instead of
		// each thumbnail being a different height depending on its own
		// photo's aspect ratio -- this old WebKit's <img> has no object-fit
		// support to do the equivalent crop directly on an <img> tag.
		//
		// Wrapped in an <a> with a fixed, no-payload "abt-fullscreen-image:"
		// URL so tapping it routes through enyo.HtmlContent's existing
		// onLinkClick -> readerLinkClick interception (see below) instead of
		// needing a separate tap-detection mechanism for non-link content.
		//
		// The actual image URL/caption are NOT encoded into the href itself
		// (an earlier version tried that, joining them with a "|" separator)
		// -- confirmed live that tapping it opened the full-screen overlay
		// correctly (proving onLinkClick/readerLinkClick fire fine) but the
		// image never loaded, most likely this old WebKit's href-normalizing
		// getter mangling a raw "|" (not a valid URI character) into %7C
		// before readerLinkClick ever saw the string, breaking the split("|")
		// unpacking. Stashed on `this` instead (currentImageUrl/
		// currentImageCaption, set here, read back in showFullScreenImage)
		// -- there's only ever one featured image per article anyway, so
		// there was never a real need to round-trip it through the href
		// string at all.
		if (extracted.imageUrl) {
			this.currentImageUrl = extracted.imageUrl;
			this.currentImageCaption = extracted.imageCaption || "";
			var safeImgUrl = extracted.imageUrl.replace(/"/g, "%22").replace(/'/g, "%27");
			html += '<a class="articleFeaturedImageLink" href="abt-fullscreen-image:">' +
				'<div class="articleFeaturedImage" style="background-image:url(&quot;' +
				enyo.string.escapeHtml(safeImgUrl) + '&quot;)"></div></a>';
			if (extracted.imageCaption) {
				html += '<div class="articleFeaturedImageCaption">' + enyo.string.escapeHtml(extracted.imageCaption) + '</div>';
			}
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
		if (typeof inUrl === "string" && inUrl.indexOf("abt-fullscreen-image:") === 0) {
			this.showFullScreenImage();
			return;
		}
		SportsLogger.log("ArticleReader", "opening in system default browser: " + inUrl);
		this.$.openInBrowserCmd.call({ target : inUrl });
	},
	openInBrowserFailed : function(inSender, inResponse) {
		SportsLogger.log("ArticleReader", "openInBrowser failed: " + JSON.stringify(inResponse).substring(0, 300));
	},

	// Full image, uncropped (unlike the fixed-ratio thumbnail) -- max-width/
	// max-height:100% on a real <img> (see .articleFullScreenImg) is enough
	// to fit it within the overlay without cutting anything off, no
	// object-fit/cover needed here since nothing is being cropped. Reads
	// currentImageUrl/currentImageCaption (set in gotArticleHtml) rather
	// than taking them as params -- see that function's own comment for why.
	showFullScreenImage : function() {
		SportsLogger.log("ArticleReader", "showFullScreenImage url=" + this.currentImageUrl);
		this.$.fullScreenImg.setSrc(this.currentImageUrl || "");
		this.$.fullScreenCaption.setContent(this.currentImageCaption || "");
		this.$.fullScreenCaption.setShowing(!!this.currentImageCaption);
		this.$.fullScreenOverlay.show();
	},
	closeFullScreenImage : function() {
		this.$.fullScreenOverlay.hide();
	}
});
