// Renders through the community Atlas browser's WPE engine (modern WebKit, ES2022) instead
// of the stock 2009 WebKit plugin. The underlying webview is really an <object> tag, and its
// "type" attribute selects which NPAPI plugin backs it -- Atlas's own AtlasEngineOverride.js
// swaps this by patching enyo.BasicWebView.prototype.create directly (NOT the higher-level
// "WebView" kind). An earlier attempt here subclassed "WebView" itself and set domAttributes
// on THAT control -- on-device testing with Atlas's own native debug log (BPWPE_DEBUG=1 ->
// /tmp/bpwpe.log) proved that never even reached Atlas's backend (no BrowserPageWPE was ever
// constructed; the log stayed empty across repeated article loads), meaning "WebView" is a
// wrapper around an internal enyo.BasicWebView, and setting the attribute on the wrapper is a
// no-op on the real object tag. Patching enyo.BasicWebView.prototype.create directly instead,
// matching Atlas's own technique exactly.
//
// Atlas isn't guaranteed to be installed on every device this app ships to; if the plugin/
// daemon isn't present the object embed will just fail to render (no graceful in-JS way to
// detect that in advance), same risk as any other optional-dependency NPAPI plugin.
(function () {
	function patch() {
		if (window.enyo && enyo.BasicWebView && enyo.BasicWebView.prototype &&
				!enyo.BasicWebView.prototype._mlbAtlasEnginePatched) {
			var orig = enyo.BasicWebView.prototype.create;
			enyo.BasicWebView.prototype.create = function () {
				orig.apply(this, arguments);
				this.domAttributes.type = "application/x-atlas-browser";
			};
			enyo.BasicWebView.prototype._mlbAtlasEnginePatched = true;
			return true;
		}
		return false;
	}
	if (!patch()) {
		var t = setInterval(function () { if (patch()) { clearInterval(t); } }, 50);
	}
})();

enyo.kind( {
	name : "mlb.GenericWebViewHeader",
	kind : "Header",
	flex: 1,
	components: [
		{
			style: "padding-left:20px; padding-top: 15px; width: 100%; height: 100%; color: white; font-weight: bold; font-size:130%; valign:middle",
			name: "title"
		}
	]
});


enyo.kind({
	name : "mlb.GenericWebView",
	kind : "enyo.VFlexBox",
	flex: 1,
	published : {
		params:null,
		title:""
	},
	components : [
	{
		kind : "enyo.VFlexBox",
		flex:1,
		components : [ {
			flex:0,
			name : "genericWebViewHeader",
			kind : "mlb.GenericWebViewHeader"

		},
		{
			kind : "VFlexBox",
			flex : 1,
			components : [
		{
				name : "webview",
				kind : "WebView",
				flex:1,

				height : "620px",
				minFontSize : "0",
				onLoadStarted : "loadStarted",
				onLoadComplete : "loadComplete"
			}
		]},

		{
			flex:0,
			kind : "Toolbar",
			height : "40px",
			components : [ {
				kind : "GrabButton"
			} ]
		}

		]

	}
	],
	create : function() {
		this.inherited(arguments);

	},
	rendered : function() {
		this.inherited(arguments);
		//alert("TITLE="+this.title);

	},
	show: function() {
		this.$.genericWebViewHeader.$.title.setContent(this.title);
		// Hide the previous article immediately -- the webview control is
		// reused across articles, so without this the old page stays visible
		// (behind the spinner) for the whole load instead of the pane looking
		// blank/fresh. visibility (not display/setShowing, which can tear
		// down and reconnect the underlying Atlas plugin) keeps the plugin
		// alive while just not painting it until the new page is ready.
		this.$.webview.applyStyle("visibility", "hidden");
		this.$.webview.setUrl(this.params.url);
	},
	loadStarted : function(){
		main.showMiddleSpinner();
	},
	loadComplete : function(){
		main.hideMiddleSpinner();
		this.$.webview.applyStyle("visibility", "visible");
	}

});

