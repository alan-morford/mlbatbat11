enyo
	.kind( {
		name : "mlb.VideoItem",
		kind : enyo.HFlexBox,
		style : "padding:10px; margin:0; border-bottom: 1px solid #A6A698; border-top: 1px solid #FFF;",
		onclick : "videoItemClick",
		published : {
			highlight : null
		},
		components : [{
			style : "padding:4px; background:rgba(0,0,0,0.3); width:98px; height:74px; margin-right: 20px",
			components : [{
				name : "videoImage",
				kind : "Image",
				className : "videoItemImage",
				style : "width:96px; height: 72px; border: 1px solid white",
				src : "imgs/default_thumb.png"
			}]
		},{
			flex : 1,
			components : [{
				className : "videoItemTitle",
				name : "videoTitle",
				nodeTag : "div"
			},{
				name : "videoBlurb",
				className : "videoItemBlurb",
				nodeTag : "div"
			}]
		}]
	});

enyo
	.kind( {
		name : "mlb.VideoView",
		kind : enyo.VFlexBox,
		flex : 1,
		published : {
			date   : null,
			gameId : "",
			highlights : [],
			loadVideos : null
		},
		components : [
			{
				kind        : "VirtualList",
				flex        : 1,
				name        : "videoList",
				onSetupRow  : "listSetupRow",
				components  : [{
					name    : "VideoItem",
					kind    : "mlb.VideoItem"
				}]
			},
			{
				name : "noVideos",
				content : "No Videos Available",
				style: "height:100px;width:200px;text-align:center;position:absolute;top:100px;width:400px;display:none;"
			},
			{
				name : "getVideos",
				kind : "VideoHighlightsService",
				onSuccess : "gotVideos",
				onFailure : "failedVideos"
			},
			{
				kind : "Popup",
				name : "popup",
				components : [{
					name    : "popupbody",
					content : ""
				}]
			}
		],
		create : function() {
		console.log("VideoView.create");
			this.games = [];
			this.inherited(arguments);
		},
		rendered : function() {
			console.log("VideoView.rendered");
			this.node = enyo.byId(this.id);
			this.inherited(arguments);
			this.childrenRendered();
			this.$.noVideos.applyStyle("display","none");//clear out no vid msg
			var that = this;

			this.loadVideos = function(){
				that.$.getVideos.urlParams = { 
					"yyyy" : that.gameId.substring(0,4),
					"mm"   : that.gameId.substring(5,7), 
					"dd"   : that.gameId.substring(8,10), 
					"gid"  : that.gameId
				};

				main.showMiddleSpinner();
				that.$.getVideos.call();
			};
		},
		videoItemClick: function(videoItem, inResponse) {
			console.log(videoItem.highlight.videoUrl);
			main.launchVideo(videoItem.highlight.videoUrl);
		},
		listSetupRow : function(inSender, inIndex) {
			console.log("this.highlights.length: " + this.highlights.length);
			if (inIndex >= 0 && inIndex < this.highlights.length) {
				var highlights = this.highlights[inIndex];
				this.$.VideoItem.$.videoTitle.setContent(highlights.headline);
				this.$.VideoItem.$.videoImage.setSrc(highlights.thumb._text);
				this.$.VideoItem.highlight = highlights;
				return true;
			}
			return false;
		},
		gotVideos : function(inSender, inResponse, inRequest) {
			main.hideMiddleSpinner();
			var json = XMLJSONConverter.convert(inResponse).highlights.media;
			this.$.videoList.$.scroller.punt();
			this.highlights = this.getGamesWithVideo( json );
			if(this.highlights.length<1){ this.$.noVideos.applyStyle("display","block"); this.$.videoList.hide(); }
			else{ this.$.noVideos.applyStyle("display","none");  this.$.videoList.show(); }
			this.$.videoList.refresh();
		},
		failedVideos : function(){
			main.hideMiddleSpinner();
			console.log("@@@@@@@@ Failed to fetch videos @@@@@@@@");
			this.$.videoList.hide();
			this.$.noVideos.applyStyle("display","block");
		},
		getGamesWithVideo : function(games) {
			var game,
				gamesWithVideo = [],
				condensedGame,
				isCondensed;

			for ( var g = 0; g < games.length; g++){
				game = games[g];
				isCondensed = (game["condensed"] == "true") ? true : false ;
				if (game.url) {
					var feeds = Util.array(game.url);
					for ( var i = 0, k = 0; feeds && i < feeds.length; i++) {
						var feed = feeds[i];
						if (feed["playback-scenario"] == main.config.videoPlaybackScenarios.high) {
							if(feed._text.indexOf("rtmp://")<0){
								game.videoUrl = feed._text;
								gamesWithVideo.push(game);
							}
						}
						else if(isCondensed && feed["playback-scenario"] == main.config.videoPlaybackScenarios.condensedGames.high){
							if(feed._text.indexOf("rtmp://")<0){
								game.videoUrl = feed._text;
								condensedGame = game;
							}
						}
					}
				}
			}
			if(condensedGame){ gamesWithVideo.splice(0,0,condensedGame); }
			return gamesWithVideo;
		}
});
