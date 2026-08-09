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
		{ name : "description", className : "gamedayPlayDescription" },
		// Only shown when play.scoringRunners is non-empty (see
		// lib/parsers/GamedayParser.js's parsePlays) -- per direct user
		// feedback, some scoring plays' own description text doesn't
		// actually name who scored, so this is always built from the real
		// runners data instead of relying on that text, and always shown
		// (even when the description also already names the runner, e.g. a
		// home run) so this line is a reliable, consistent source of truth
		// rather than something that sometimes appears and sometimes
		// doesn't. gamedayPlayItemScored (whole-row bold/highlight) is set
		// alongside it -- see css/GamedayView.css.
		{ name : "scoringLine", className : "gamedayPlayScoringLine", showing : false },
		// Only shown for a challenged at-bat (play.isAbsChallenge -- see
		// lib/parsers/GamedayParser.js's parsePlays) -- an obvious tappable
		// link (not just relying on the whole row's own onclick, which has
		// no visual affordance at all) into that challenge's ABS Stat
		// detail. Styled as a link in css/GamedayView.css's
		// .gamedayPlayChallengeLink.
		{ name : "challengeLink", className : "gamedayPlayChallengeLink", content : "Call Challenged →", showing : false }
	],
	setPlay : function(play) {
		this.play = play;
		var half = (play.halfInning === "top") ? "Top" : "Bot";
		this.$.inningLabel.setContent(half + " " + play.inning);
		this.$.description.setContent(play.description);
		var scoringRunners = play.scoringRunners || [];
		if (scoringRunners.length) {
			var verb = scoringRunners.length === 1 ? " scores." : " score.";
			this.$.scoringLine.setContent(scoringRunners.join(", ") + verb);
		}
		this.$.scoringLine.setShowing(scoringRunners.length > 0);
		this.addRemoveClass("gamedayPlayItemScored", scoringRunners.length > 0);
		this.$.challengeLink.setShowing(!!play.isAbsChallenge);
		this.addRemoveClass("gamedayPlayItemChallenged", !!play.isAbsChallenge);
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
			// onclick here (declared directly on the templated row, same
			// pattern already proven working elsewhere in this app -- see
			// views/NewsView.js's articleListItemClick on ITS OWN VirtualList
			// row template) resolves against whichever kind's own
			// `components` array actually contains this VirtualList, i.e.
			// mlb.GamedayPlayByPlay below, NOT the VirtualList itself.
			components : [ { kind : "mlb.GamedayPlayItem", onclick : "playItemClick" } ]
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
	},
	// inSender is the tapped mlb.GamedayPlayItem instance -- ignore taps on
	// a normal (non-challenged) play, there's nothing to show. Forwards one
	// hop up to mlb.GamedayLive (this kind's own owner -- see
	// views/GamedayView.js), same explicit per-level forwarding style
	// already used by mlb.AbsScoreboard.openGamedayForGame in
	// views/AbsStatsView.js, rather than reaching further up the owner
	// chain directly.
	playItemClick : function(inSender) {
		var play = inSender && inSender.play;
		if (!play || !play.isAbsChallenge) {
			return;
		}
		if (this.owner && this.owner.challengeTapped) {
			this.owner.challengeTapped(play);
		}
	}
});
