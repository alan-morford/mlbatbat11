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
		this.$.webview.setUrl(this.params.url);
	},
	loadStarted : function(){
		main.showMiddleSpinner();
	},
	loadComplete : function(){
		main.hideMiddleSpinner();
	}
	
});

