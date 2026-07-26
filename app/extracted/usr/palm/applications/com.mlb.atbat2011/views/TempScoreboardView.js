var platform = "IPHONE";
var audioSKU = "IPHONEATBAT2011";

enyo.kind( {
	name : "mlb.AudioFeed",
	published : {
		feed : null,
		game : null
	}

});

enyo
		.kind( {
			name : "mlb.TempScoreboardItem",
			kind : enyo.HFlexBox,
			published : {
				game:null
			},
			components : [
					{
						name : "gameTitle"
					}]
		});

enyo
		.kind( {
			name : "mlb.TempScoreboardView",
			kind : enyo.VFlexBox,
			flex : 1,
			published : {
				date : null
			},
			components : [
					{
						kind : "VirtualList",
						flex : 1,
						name : "list",
						onSetupRow : "listSetupRow",
						components : [ {
							name: "scoreboardItem",
							kind : "mlb.TempScoreboardItem",
							onclick: "scoreboardItemClick"
						} ]
					},

					{
						name : "scoreboardService",
						kind : "WebService",
						//url : "http://gdx.mlb.com/components/game/mlb/year_2011/month_06/day_27/scoreboard_iphone.xml",
						//url : "/Users/morizzle/Documents/workspace/AtBat/sampledata/scoreboard_android.xml",
						method : "GET",
						handleAs : "xml",
						onSuccess : "scoreboardServiceReturn"
					} ],
			create : function() {
				
				this.games = [];
				this.inherited(arguments);

			},
			rendered : function() {
				this.node = enyo.byId(this.id);
				this.inherited(arguments);
				this.childrenRendered();

				var date  = new Date();
				var dateFormat = new enyo.g11n.DateFmt("yyyyMMdd");
				var dateStr = dateFormat.format(date);
			
				//this.$.scoreboardService.setUrl(enyo.macroize("http://gdx.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/scoreboard_iphone.xml",{"yyyy": dateStr.substring(0,4), "mm": dateStr.substring(4,6), "dd": dateStr.substring(6)}));
				this.$.scoreboardService.setUrl(enyo.macroize("http://gdx.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/scoreboard_iphone.xml",{"yyyy": 2011, "mm": "07", "dd":"04"}));
				this.$.scoreboardService.call();
				
				
			},
			scoreboardItemClick: function(scoreboardItem, inResponse) {
				
				//print(scoreboardItem.game);
				//gamedayView.game = scoreboardItem.game;
				main.showViewInRight(" ", GamedayView);
				GamedayView.setGame(scoreboardItem.game);
				
				
			},
			listSetupRow : function(inSender, inIndex) {

				if (inIndex >= 0 && inIndex < this.games.length) {
					var game = this.games[inIndex];
					
					this.$.scoreboardItem.$.gameTitle
							.setContent(game.away_name_abbrev + " at " + game.home_name_abbrev);
					this.$.scoreboardItem.game = game;
				

					return true;
				}
				return false;
			},

			scoreboardServiceReturn : function(inSender, inResponse, inRequest) {
				console.log("scoreboardServiceReturn");
				this.games = XMLJSONConverter
						.convert(inResponse).games.game;
				
				this.$.list.refresh();
			}
});
