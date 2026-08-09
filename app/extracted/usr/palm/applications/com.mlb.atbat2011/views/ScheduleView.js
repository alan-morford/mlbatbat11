// "Schedule" -- own top-level left-nav entry (data/localExtras.js's
// leftnav, views/Panels2.js's panes, views/Main.js's Views registry),
// sibling of Teams/Videos/etc, NOT a sub-section of anything else. Same
// two-pane drill-down shape as views/AbsTeamsView.js's mlb.TeamsView:
//   mlb.AbsTeamGrid    -- the SAME 4-wide team-logo grid Teams uses (reused
//                         directly, not duplicated -- see that kind's own
//                         comment on its now-generic teamTileTapped hook)
//   mlb.ScheduleCalendar -- tapped team's month calendar: 7-wide grid of
//                         day cells (opponent + win/loss or upcoming),
//                         with Prev/Next month navigation
//
// Data source: MLB Stats API's schedule?teamId=X&startDate=...&endDate=...
// (TeamScheduleAPIService, lib/WebServices.js) -- confirmed live
// (2026-08-09) this same range form works for past, current, AND future
// months with no separate endpoint (MLB publishes the full season in
// advance; a future month's games come back with status "Preview" and no
// score).
//
// Scope note: day cells show opponent (abbreviation, home/away) and
// result/status as TEXT only, no per-cell team logo and no local start
// time for upcoming games -- kept simple/reliable for a ~104px-wide month
// grid cell; can be revisited if wanted.

// ---------------------------------------------------------------------------
// One day cell in the month grid. Plain enyo.Control + float-based CSS grid
// -- same technique as views/ScoreboardGameBox.js/mlb.AbsTeamTile (nesting
// Enyo's flex kinds inside a float-wrapping grid caused inconsistent
// row-wrapping on this old WebKit, per those files' own header comments).
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.ScheduleDayCell",
	kind : "enyo.Control",
	className : "scheduleDayCell",
	published : {
		game : null,
		dayNum : null
	},
	components : [
		{ name : "dayNum", className : "scheduleDayCellNum" },
		{ name : "opponent", className : "scheduleDayCellOpponent" },
		{ name : "result", className : "scheduleDayCellResult" }
	],
	// dayNum null == a leading/trailing blank cell (padding out the grid to
	// align the real days under the correct weekday column) -- game null ==
	// a real day this team didn't play (an off day).
	setDay : function (dayNum, game) {
		this.dayNum = dayNum;
		this.game = game;
		this.addRemoveClass("scheduleDayCellEmpty", !dayNum);
		this.$.dayNum.setContent(dayNum ? String(dayNum) : "");
		this.removeClass("scheduleDayCellWin");
		this.removeClass("scheduleDayCellLoss");
		if (!dayNum || !game) {
			this.$.opponent.setContent("");
			this.$.result.setContent("");
			return;
		}
		var oppRef = MLBTeamReference.getById(game.opponentId);
		var oppAbbr = (oppRef && oppRef.abbreviation) || "";
		this.$.opponent.setContent((game.isHome ? "vs " : "@ ") + oppAbbr);
		if (game.isFinal) {
			this.$.result.setContent((game.isWinner ? "W " : "L ") + game.usScore + "-" + game.oppScore);
			this.addRemoveClass("scheduleDayCellWin", game.isWinner);
			this.addRemoveClass("scheduleDayCellLoss", !game.isWinner);
		} else {
			this.$.result.setContent(game.abstractGameState === "Live" ? "Live" : this.formatGameTime(game.gameDate));
		}
	},
	// game.gameDate is UTC ISO -- new Date(...).getHours()/getMinutes() read
	// back in the DEVICE's own local timezone with no extra library needed
	// (unlike lib/parsers/GameSummaryParser.js's Eastern-specific conversion
	// elsewhere in this app, which exists to match ESPN's own day-bucketing,
	// not to display a time to the user).
	formatGameTime : function (isoString) {
		var d = new Date(isoString);
		if (isNaN(d.getTime())) {
			return "";
		}
		var h = d.getHours(), m = d.getMinutes();
		var ampm = (h >= 12) ? "PM" : "AM";
		var h12 = h % 12;
		if (h12 === 0) {
			h12 = 12;
		}
		return h12 + ":" + ("0" + m).slice(-2) + " " + ampm;
	}
});

// Header -- team name + Prev/Next month, structured as a byte-for-byte copy
// of views/ScoreboardView.js's own mlb.ScoreboardHeader (two flex:1 boxes:
// one for a left-side label, one named "DateNav" laid out via
// layoutKind:"HFlexLayout") and reusing its EXACT date-nav classes
// (.prevButton/.gameDate/.nextButton, css/ScoreboardView.css) instead of
// this file's own -- per direct user request for design consistency with
// Scoreboard/ABS Stats (mlb.AbsScoreboardHeader reuses that same
// mlb.ScoreboardHeader kind directly, so fixing/matching it there covers
// both at once). No calendar-icon/jump-to-date popup button -- that's a
// genuinely different feature (Scoreboard's own DatePicker popup) this
// month-at-a-time view has no equivalent of. No back button either -- per
// direct user request, this pane relies on swipe alone to return to the
// team grid. Safe to do here (unlike views/GameSummaryView.js's
// Play-by-Play pane, which needed an explicit button instead -- see that
// file's own comment): this calendar is a flat view, pane1 of
// mlb.ScheduleView's own single 2-pane SlidingPane with nothing nested
// inside it, the exact single-level shape GrabButton/swipe is confirmed to
// work correctly for (this pane already has one, at its bottom).
enyo.kind({
	name : "mlb.ScheduleCalendarHeader",
	kind : "Header",
	components : [ {
		kind : enyo.HFlexBox,
		flex : 0,
		className : "scheduleTeamNameBox",
		components : [
			{ name : "teamName", className : "gamedayMatchup scheduleTeamName" }
		]
	}, {
		name : "DateNav",
		flex : 1,
		layoutKind : "HFlexLayout",
		components : [
			{
				kind : "CustomButton",
				name : "prevButton",
				className : "prevButton",
				onclick : "prevClicked",
				components : [ { kind : "Image", src : "imgs/previous.png" } ]
			},
			{ name : "monthLabel", className : "gameDate" },
			{
				kind : "CustomButton",
				name : "nextButton",
				className : "nextButton",
				onclick : "nextClicked",
				components : [ { kind : "Image", src : "imgs/next.png" } ]
			}
		]
	} ],
	prevClicked : function () {
		this.owner.changeMonth(-1);
	},
	nextClicked : function () {
		this.owner.changeMonth(1);
	},
	setTeamName : function (text) {
		this.$.teamName.setContent(text);
	},
	setMonthLabel : function (text) {
		this.$.monthLabel.setContent(text);
	}
});

// ---------------------------------------------------------------------------
// Pane: tapped team's month calendar.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.ScheduleCalendar",
	kind : "enyo.VFlexBox",
	flex : 1,
	components : [
		{ name : "header", kind : "mlb.ScheduleCalendarHeader", flex : 0 },
		{
			name : "scroller",
			kind : "enyo.Scroller",
			flex : 1,
			components : [
				{ name : "weekdayRow", className : "scheduleWeekdayRow" },
				{ name : "grid", className : "scheduleCalendarGrid" }
			]
		},
		{ kind : "Toolbar", height : "40px", flex : 0, components : [ { kind : "GrabButton" } ] },
		{
			name : "getSchedule",
			kind : "TeamScheduleAPIService",
			onSuccess : "gotSchedule",
			onFailure : "scheduleFailed"
		}
	],

	currentTeam : null,
	monthDate : null, // first-of-month Date for whatever's currently displayed

	create : function () {
		this.inherited(arguments);
		var labels = [ "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" ];
		for (var i = 0; i < labels.length; i++) {
			this.$.weekdayRow.createComponent({ className : "scheduleWeekdayCell", content : labels[i] });
		}
		this.$.weekdayRow.render();
	},

	// Always starts on the CURRENT calendar month -- same "reselecting
	// always resets to a known entry state" spec as this app's other
	// drill-down panes (e.g. views/AbsTeamsView.js's mlb.AbsTeamRoster
	// resetting scroll position on a new team).
	loadTeam : function (team) {
		this.currentTeam = team;
		this.$.header.setTeamName(team.location ? (team.location + " " + team.nickname) : team.name);
		var today = new Date();
		this.monthDate = new Date(today.getFullYear(), today.getMonth(), 1);
		this.fetchMonth();
	},

	changeMonth : function (delta) {
		if (!this.monthDate) {
			return;
		}
		this.monthDate = new Date(this.monthDate.getFullYear(), this.monthDate.getMonth() + delta, 1);
		this.fetchMonth();
	},

	fetchMonth : function () {
		var y = this.monthDate.getFullYear(), m = this.monthDate.getMonth();
		this.$.header.setMonthLabel(Months[m] + " " + y);
		var lastDay = new Date(y, m + 1, 0).getDate();
		var pad = function (n) { return ("0" + n).slice(-2); };
		var startDate = y + "-" + pad(m + 1) + "-01";
		var endDate = y + "-" + pad(m + 1) + "-" + pad(lastDay);

		this.$.grid.destroyComponents();
		this.$.grid.render();
		this.$.scroller.scrollTo(0, 0);
		main.showMiddleSpinner();
		this.$.getSchedule.urlParams = {
			teamId : this.currentTeam.id,
			startDate : startDate,
			endDate : endDate
		};
		this.$.getSchedule.call();
	},

	gotSchedule : function (inSender, inResponse) {
		main.hideMiddleSpinner();
		try {
			var byDate = ScheduleParser.parseTeamSchedule(inResponse, this.currentTeam.id);
			this.renderMonth(byDate);
		} catch (e) {
			console.log("ScheduleCalendar gotSchedule parse error: " + e);
		}
	},
	scheduleFailed : function (inSender, inResponse) {
		main.hideMiddleSpinner();
		console.log("ScheduleCalendar scheduleFailed: " + JSON.stringify(inResponse).substring(0, 300));
	},

	renderMonth : function (byDate) {
		var y = this.monthDate.getFullYear(), m = this.monthDate.getMonth();
		var daysInMonth = new Date(y, m + 1, 0).getDate();
		var firstWeekday = new Date(y, m, 1).getDay(); // 0=Sun..6=Sat
		var pad = function (n) { return ("0" + n).slice(-2); };

		this.$.grid.destroyComponents();
		for (var i = 0; i < firstWeekday; i++) {
			this.$.grid.createComponent({ kind : "mlb.ScheduleDayCell" }).setDay(null, null);
		}
		for (var d = 1; d <= daysInMonth; d++) {
			var dateKey = y + "-" + pad(m + 1) + "-" + pad(d);
			this.$.grid.createComponent({ kind : "mlb.ScheduleDayCell" }).setDay(d, byDate[dateKey] || null);
		}
		// Trail out to a full row so the grid's own float-wrap doesn't leave
		// a ragged last row (matches every other float-grid in this app).
		var totalCells = firstWeekday + daysInMonth;
		var trailing = (7 - (totalCells % 7)) % 7;
		for (var t = 0; t < trailing; t++) {
			this.$.grid.createComponent({ kind : "mlb.ScheduleDayCell" }).setDay(null, null);
		}
		this.$.grid.render();
	}
});

// ---------------------------------------------------------------------------
// Outer orchestrator -- registered as the "Schedule" top-level pane. Same
// shape as views/AbsTeamsView.js's own mlb.TeamsView, just with
// mlb.ScheduleCalendar in place of the roster/player-stats drill-down.
// ---------------------------------------------------------------------------
enyo.kind({
	name : "mlb.ScheduleView",
	kind : "SlidingPane",
	flex : 1,
	multiViewMinWidth : 0,
	components : [ {
		name : "teamsGridPane",
		width : "824px",
		components : [ { name : "teamsGrid", kind : "mlb.AbsTeamGrid", flex : 1 } ]
	}, {
		name : "calendarPane",
		components : [ { name : "calendar", kind : "mlb.ScheduleCalendar", flex : 1 } ]
	} ],

	// Always reset back to the team grid, same "always reset to the entry
	// pane" spec as mlb.TeamsView.show/mlb.NewsView.show.
	show : function () {
		this.$.teamsGridPane.select();
	},

	// mlb.AbsTeamGrid's generic tap hook (see that kind's own comment).
	teamTileTapped : function (team) {
		this.$.calendar.loadTeam(team);
		this.$.calendarPane.select();
	}
});
