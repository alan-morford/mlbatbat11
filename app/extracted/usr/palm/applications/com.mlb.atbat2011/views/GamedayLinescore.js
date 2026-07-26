// Per-inning R/H/E line + current count/outs for a game, native. Small,
// fixed-size (at most ~9-15 columns) -- no VirtualList needed, just
// create/destroy per render like views/ScoreboardList.js's tile grid.
//
// inningsRow/awayRow/homeRow are wrapped in a scoreTable container styled
// as a CSS table (display:table/table-row/table-cell in css/GamedayView.css)
// instead of float:left -- floats left alignment dependent on three
// independently-built rows happening to use identical cell widths/order,
// nothing structurally tied them together, and the header row's inning
// numbers didn't reliably line up above the actual per-team score columns
// as a result. A CSS table gives the browser's own table layout algorithm
// the job of keeping columns aligned across rows, which floats can't
// guarantee. setLinescore/renderTeamRow's own logic is unchanged -- this
// is a container-add + CSS-class change only.
enyo.kind({
	name : "mlb.GamedayLinescore",
	kind : "enyo.Control",
	className : "gamedayLinescore",
	components : [
		{ name : "scoreTable", className : "linescoreTable", components : [
			{ name : "inningsRow", className : "linescoreRow linescoreHeaderRow" },
			{ name : "awayRow", className : "linescoreRow" },
			{ name : "homeRow", className : "linescoreRow" }
		]},
		{ name : "situation", className : "linescoreSituation" }
	],
	setLinescore : function(linescore, awayName, homeName) {
		if (!linescore) {
			return;
		}

		this.$.inningsRow.destroyComponents();
		this.$.inningsRow.createComponent({ className : "linescoreLabelCell", content : "" });
		for (var i = 0; i < linescore.innings.length; i++) {
			this.$.inningsRow.createComponent({ className : "linescoreCell", content : String(linescore.innings[i].num) });
		}
		this.$.inningsRow.createComponent({ className : "linescoreCell linescoreTotalCell", content : "R" });
		this.$.inningsRow.createComponent({ className : "linescoreCell linescoreTotalCell", content : "H" });
		this.$.inningsRow.createComponent({ className : "linescoreCell linescoreTotalCell", content : "E" });
		this.$.inningsRow.render();

		this.renderTeamRow(this.$.awayRow, awayName, linescore.innings, "away", linescore.awayTotals);
		this.renderTeamRow(this.$.homeRow, homeName, linescore.innings, "home", linescore.homeTotals);

		var situation = "";
		if (linescore.currentInning) {
			situation = (linescore.inningState || "") + " " + linescore.currentInning
				+ " | " + linescore.balls + "-" + linescore.strikes + ", " + linescore.outs + " out";
		}
		this.$.situation.setContent(situation);
	},
	renderTeamRow : function(container, name, innings, side, totals) {
		container.destroyComponents();
		container.createComponent({ className : "linescoreLabelCell", content : name });
		for (var i = 0; i < innings.length; i++) {
			var val = innings[i][side];
			container.createComponent({ className : "linescoreCell", content : (val === null || val === undefined) ? "" : String(val) });
		}
		container.createComponent({ className : "linescoreCell linescoreTotalCell", content : String(totals.runs) });
		container.createComponent({ className : "linescoreCell linescoreTotalCell", content : String(totals.hits) });
		container.createComponent({ className : "linescoreCell linescoreTotalCell", content : String(totals.errors) });
		container.render();
	}
});
