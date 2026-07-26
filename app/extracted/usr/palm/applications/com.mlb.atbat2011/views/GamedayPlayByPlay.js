// Scrolling play-by-play text feed, most recent at-bat first. Uses
// VirtualList directly (a simple vertical list, not a wrapping grid) --
// the earlier Scoreboard scroll-blanking bug was specific to combining
// VirtualList with float-wrapping grid CSS, not with a plain vertical list
// like this one; this matches the already-proven VirtualList usage in
// views/AudioView.js/NewsView.js.
enyo.kind({
	name : "mlb.GamedayPlayItem",
	kind : "enyo.Control",
	className : "gamedayPlayItem",
	published : {
		play : null
	},
	components : [
		{ name : "inningLabel", className : "gamedayPlayInning" },
		{ name : "description", className : "gamedayPlayDescription" }
	],
	setPlay : function(play) {
		this.play = play;
		var half = (play.halfInning === "top") ? "Top" : "Bot";
		this.$.inningLabel.setContent(half + " " + play.inning);
		this.$.description.setContent(play.description);
	}
});

enyo.kind({
	name : "mlb.GamedayPlayByPlay",
	kind : "enyo.VFlexBox",
	flex : 1,
	published : {
		plays : []
	},
	components : [
		{
			name : "noPlays",
			className : "gamedayNoPlays",
			content : "No plays yet.",
			showing : false
		},
		{
			kind : "VirtualList",
			flex : 1,
			name : "list",
			onSetupRow : "listSetupRow",
			components : [ { kind : "mlb.GamedayPlayItem" } ]
		}
	],
	setPlays : function(plays) {
		this.plays = plays || [];
		this.$.noPlays.setShowing(this.plays.length === 0);
		this.$.list.setShowing(this.plays.length > 0);
		this.$.list.refresh();
	},
	listSetupRow : function(inSender, inIndex) {
		if (inIndex >= 0 && inIndex < this.plays.length) {
			this.$.gamedayPlayItem.setPlay(this.plays[inIndex]);
			return true;
		}
		return false;
	}
});
