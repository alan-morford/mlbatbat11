// Native list of ScoreboardGameBox tiles, replacing the old jQuery-templated
// #fullScoreboard markup. Deliberately NOT a VirtualList: VirtualList
// recycles rows via absolute-positioned offsets sized off a fixed row
// height, which fights the floated wrapping-grid layout this view uses
// (ported from the original #fullScoreboard CSS) -- it caused the pane to
// go blank on scroll. A day's slate is at most ~15 games, so there's no real
// need for virtualization; this just creates/destroys one child per game
// inside a STATIC "gamesContainer" sub-component (proven to actually render:
// an earlier version that instead destroyComponents()/createComponent()/
// render()'d directly on mlb.ScoreboardList itself -- with no static
// children at all -- rendered nothing).
//
// Click handling: Enyo 1.0's createComponent() sets a dynamically created
// child's owner to whatever object you called it ON (here, gamesContainer),
// NOT that object's own owner. So the click handler has to live directly on
// gamesContainer's own declaration (matching how views/Main.js's
// configureLeftNav()/leftNav.itemClicked is structured -- the one other
// proven-working dynamic-component-with-click pattern in this app), and
// delegate up via gamesContainer's own owner (mlb.ScoreboardList, per
// normal static-nesting rules) to reach mlb.ScoreboardList.gameBoxClick.
enyo.kind({
	name : "mlb.ScoreboardList",
	kind : "enyo.VFlexBox",
	flex : 1,
	published : {
		games : []
	},
	components : [
		{
			name : "noGames",
			className : "scoreboardNoGames",
			content : "No games scheduled",
			showing : false
		},
		{
			name : "gamesContainer",
			className : "scoreboardGamesContainer",
			tileClicked : function(inSender) {
				if (this.owner && this.owner.gameBoxClick) {
					this.owner.gameBoxClick(inSender);
				}
			}
		}
	],
	setGames : function(games) {
		this.games = games || [];
		this.$.noGames.setShowing(this.games.length === 0);
		this.$.gamesContainer.setShowing(this.games.length > 0);

		this.$.gamesContainer.destroyComponents();
		for (var i = 0; i < this.games.length; i++) {
			var box = this.$.gamesContainer.createComponent({
				kind : "mlb.ScoreboardGameBox",
				onclick : "tileClicked"
			});
			box.setGame(this.games[i]);
		}
		this.$.gamesContainer.render();
	},
	gameBoxClick : function(inSender) {
		var game = inSender.game;
		if (game && this.owner && this.owner.openGamedayForGame) {
			this.owner.openGamedayForGame(game);
		}
	}
});
