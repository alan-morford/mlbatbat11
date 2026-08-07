// Turns a raw article-page HTML string into clean {title, byline, content}
// article HTML, using lib/external/Readability.js (vendored Mozilla
// Readability, the same algorithm behind Firefox's Reader View) run against
// a REAL DOM instead of jsdom -- see views/ArticleReaderView.js for why:
// jsdom only exists to fake a DOM for Node.js: this app already has a real
// one (this WebKit), so DOMParser + Readability needs zero Node/jsdom
// dependency at all, sidestepping the whole "can this old on-device Node
// runtime run jsdom" question entirely.
//
// The raw HTML itself is expected to come from com.mlb.atbat2011.service's
// curl-backed httpRequest command (see views/ArticleReaderView.js), not
// this app's own WebKit XHR/WebView -- confirmed live that fetching an
// ESPN URL from this app's own networking gets Akamai-403'd (see the
// mlbatbat_espn_akamai_block project memory); curl doesn't hit that.
var ArticleExtract = {};

// Strips <script>...</script> blocks from the raw HTML STRING, before any
// parsing happens. Belt-and-suspenders alongside the sandbox="allow-same-
// origin" attribute on the scratch iframe below (no allow-scripts, so nothing
// in it should execute at all) and Readability's own _prepDocument script
// removal (which only runs AFTER parsing/on the already-live document) --
// this is deliberately layered defense, not redundant, since it's not
// confirmed the `sandbox` attribute is honored on this app's specific old
// WebKit build (see extract()'s own comment on why a live, script-executing
// document is used here at all).
ArticleExtract._stripScriptsFromString = function (html) {
	return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
};

// Readability's own _prepDocument already strips <script>/<noscript> from
// the whole document before scoring/extraction (see Readability.js's
// _prepDocument) -- this is a defensive second pass on top of that, since
// the result gets injected via allowHtml:true into this app's own
// privileged WebKit context (which has Luna/PalmService bus access), not a
// sandboxed iframe.
ArticleExtract._sanitize = function (root) {
	var DANGEROUS_TAGS = ["script", "style", "iframe", "object", "embed", "link", "meta", "form"];
	var i, nodes;
	for (i = 0; i < DANGEROUS_TAGS.length; i++) {
		nodes = root.getElementsByTagName(DANGEROUS_TAGS[i]);
		while (nodes.length) {
			nodes[0].parentNode.removeChild(nodes[0]);
		}
	}
	var all = root.getElementsByTagName("*");
	for (i = 0; i < all.length; i++) {
		var el = all[i];
		var attrs = el.attributes;
		for (var k = attrs.length - 1; k >= 0; k--) {
			var name = attrs[k].name;
			var value = attrs[k].value || "";
			if (name.toLowerCase().indexOf("on") === 0 || value.toLowerCase().indexOf("javascript:") === 0) {
				el.removeAttribute(name);
			}
		}
	}
};

// Parses an HTML string into a real Document, the old-browser-compatible
// way. Confirmed live on-device (2026-08-07, via SportsLogger) that this
// app's real WebKit (webOS 3.0.5, ~2011, AppleWebKit/534.6) returns a falsy
// result from `new DOMParser().parseFromString(html, "text/html")` --
// DOMParser's HTML-parsing mode ("text/html", as opposed to XML types) is a
// later spec addition WebKit didn't support until years after this build.
// A hidden, off-DOM-flow iframe's document, populated via the classic
// document.open()/write()/close() API (universally supported, predates
// DOMParser entirely), gives a genuine parsed Document with .title/.head/
// .body/.documentElement -- everything Readability needs -- on any browser
// old enough to run this app at all.
//
// sandbox="allow-same-origin" (no allow-scripts) is set so nothing in the
// untrusted page can execute even if the browser honors it (not confirmed
// either way on this WebKit build -- hence _stripScriptsFromString above as
// a second layer regardless). allow-same-origin specifically is required
// even though this iframe was never cross-origin-navigated -- omitting it
// makes a sandboxed iframe's origin "opaque" per spec, which would block
// this code's own synchronous access to contentDocument.
// Returns the created <iframe> element itself (NOT just its document) --
// callers must remove it from the DOM themselves once fully done with the
// document (see extract()'s finally block below). Deliberately NOT cleaned
// up in here: Readability's _grabArticle runs a fairly deep, multi-pass DOM
// walk/mutation over the whole document afterward, and detaching an
// iframe from the DOM before that finishes risks the underlying browsing
// context (and the liveness of everything under its document) being torn
// down mid-algorithm on some engine -- safer to keep it attached for the
// entire extraction and only detach at the very end.
ArticleExtract._createParsedFrame = function (html) {
	var iframe = document.createElement("iframe");
	iframe.setAttribute("sandbox", "allow-same-origin");
	// Off-screen, not display:none -- some WebKit versions never populate
	// contentDocument for a display:none iframe.
	iframe.style.position = "absolute";
	iframe.style.left = "-9999px";
	iframe.style.width = "1px";
	iframe.style.height = "1px";
	document.body.appendChild(iframe);
	var idoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
	if (!idoc) {
		iframe.parentNode.removeChild(iframe);
		return null;
	}
	idoc.open();
	idoc.write(ArticleExtract._stripScriptsFromString(html));
	idoc.close();
	return iframe;
};

// html: raw HTML string of the article page.
// articleUrl: the page's real URL -- needed so relative image/link URLs in
// the extracted content resolve correctly. The scratch document from
// _parseDocument above has no real baseURI of its own (it was never
// navigated to articleUrl), so a <base> element is inserted before running
// Readability; per the DOM spec this is exactly what makes Node.baseURI
// resolve against it. See lib/external/Readability.js's _fixRelativeUris
// patch comment for the other half of this (old WebKit has no URL
// constructor either).
//
// Returns {title, byline, content} (content is a sanitized HTML string) on
// success, or null if extraction failed or the page wasn't article-shaped
// (Readability's own DEFAULT_CHAR_THRESHOLD -- too little real content).
ArticleExtract.extract = function (html, articleUrl) {
	if (!html || !articleUrl) {
		return null;
	}
	var iframe;
	try {
		iframe = ArticleExtract._createParsedFrame(html);
	} catch (e) {
		SportsLogger.log("ArticleExtract", "_createParsedFrame threw: " + (e && e.stack ? e.stack : e));
		return null;
	}
	if (!iframe) {
		SportsLogger.log("ArticleExtract", "_createParsedFrame returned no iframe (no contentDocument available)");
		return null;
	}

	try {
		var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
		if (!doc || !doc.documentElement || !doc.body) {
			SportsLogger.log("ArticleExtract", "parsed doc missing documentElement/body (doc=" + !!doc +
				", documentElement=" + !!(doc && doc.documentElement) + ", body=" + !!(doc && doc.body) + ")");
			return null;
		}
		if (doc.head) {
			var base = doc.createElement("base");
			base.setAttribute("href", articleUrl);
			doc.head.insertBefore(base, doc.head.firstChild);
		}

		var result;
		try {
			var reader = new Readability(doc, {
				serializer : function (el) {
					ArticleExtract._sanitize(el);
					return el.innerHTML;
				}
			});
			result = reader.parse();
		} catch (e) {
			SportsLogger.log("ArticleExtract", "Readability threw: " + (e && e.stack ? e.stack : e));
			return null;
		}
		if (!result) {
			SportsLogger.log("ArticleExtract", "Readability.parse() returned null (page didn't reach even the last-resort attempt)");
			return null;
		}
		// Readability's own DEFAULT_CHAR_THRESHOLD (500) only causes a null
		// return as an absolute last resort (see _grabArticle's attempts-sort
		// fallback) -- non-article pages (e.g. ESPN video-clip pages, confirmed
		// live: a real one extracted "content" that was just the headline
		// again, 145 chars) still come back with SOME short, useless content
		// rather than null. Treat anything under this floor as a failed
		// extraction too, so views/ArticleReaderView.js correctly falls back
		// to the live view instead of showing a near-empty "article".
		var MIN_TEXT_LENGTH = 200;
		var textLen = result.textContent ? result.textContent.trim().length : 0;
		if (!result.content || textLen < MIN_TEXT_LENGTH) {
			SportsLogger.log("ArticleExtract", "content too short: textLength=" + textLen + " (min " + MIN_TEXT_LENGTH + "), hasContent=" + !!result.content);
			return null;
		}
		return {
			title : result.title || "",
			byline : result.byline || "",
			content : result.content
		};
	} finally {
		// Only detach now that Readability is fully done with the document
		// -- see _createParsedFrame's comment for why not sooner.
		if (iframe.parentNode) {
			iframe.parentNode.removeChild(iframe);
		}
	}
};
