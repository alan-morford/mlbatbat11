// Shared rendering for a single ABS challenge record (Baseball Savant's
// per-pitch challenge shape -- see the service's getAbsChallengeEvents,
// MLBAudioService.js). Extracted out of views/AbsStatsView.js's
// mlb.AbsGameStats (which still uses this for its full per-game challenge
// list) so views/GamedayView.js's challenge-detail pane (tapped from a
// single challenged play-by-play row -- see mlb.GamedayChallengeDetail) can
// render the exact same markup for one challenge without duplicating it.
var AbsChallengeFormat = {};

// call_name is Savant's (and MLB Stats API's own pitch-call field's) FINAL,
// post-review call -- NOT the umpire's original one. Confirmed live
// 2026-08-08 against gamePk 824081 (Cubs @ Royals, 2026-08-07), per direct
// user report that a top-9th challenge was showing backwards (app said
// "umpire called Ball, overturned to Strike"; user had independently
// looked up the real call as Strike overturned to Ball). Two pitches in
// this same game prove it decisively: Bregman's top-9th challenge has
// call_name:"Ball", and MLB's own feed/live shows that exact pitch's
// official call as {code:"B", description:"Ball"} under a hasReview:true/
// isOverturned:true reviewDetails block -- i.e. "Ball" IS the record after
// review, not before. Even clearer: Ian Happ's top-7th challenge has
// call_name:"Strike", and Savant's own free-text `des` for that pitch
// reads "call on the field was overturned: Ian Happ called out on
// strikes" -- call_name:"Strike" matches the FINAL "called out on
// strikes" outcome, so the umpire's original (wrong, overturned) call on
// that pitch was actually a Ball. This function previously did the
// opposite: treated call_name as the original call and flipped it to get
// the final one, which silently swapped which call reported as "before"
// vs "after" on every single overturned challenge.
AbsChallengeFormat.getFinalCall = function (c) {
	return c.call_name || "";
};

// The call as the human plate umpire actually announced live, before any
// challenge -- the opposite of the (already-final) call_name if the
// challenge overturned it, otherwise the same. See getFinalCall's comment
// above for how this was confirmed. Shared by buildChallengeTextHtml.
AbsChallengeFormat.getOriginalCall = function (c) {
	var finalCall = c.call_name || "";
	if (!c.is_overturned) {
		return finalCall;
	}
	return (finalCall === "Strike") ? "Ball" : (finalCall === "Ball") ? "Strike" : finalCall;
};

// Builds the structured challenge-detail sentence, per direct user
// feedback that Savant's own free-text `des` field included more than
// expected (full play outcome, not just the challenge itself), and that
// naming the specific PLAYER who challenged wasn't wanted -- just their
// ROLE (batter/catcher/pitcher). See the service's getAbsChallengeEvents
// for where balls/strikes come from.
AbsChallengeFormat.buildChallengeTextHtml = function (c) {
	var originalCall = AbsChallengeFormat.getOriginalCall(c);
	var finalCall = AbsChallengeFormat.getFinalCall(c);
	var challengerRole = "";
	if (c.challenging_player_type === "batter") {
		challengerRole = "Batter";
	} else if (c.challenging_player_type === "pitcher") {
		challengerRole = "Pitcher";
	} else if (c.challenging_player_type === "catcher") {
		challengerRole = "Catcher";
	}
	var hasCount = typeof c.balls === "number" && typeof c.strikes === "number";
	// c.balls/c.strikes are the count BEFORE this pitch, not after --
	// confirmed live (2026-08-07) against two real challenged pitches, both
	// pitch_number:1 within their at-bat with balls/strikes identically
	// matching Savant's own pre_balls/pre_strikes fields (0-0 in both
	// cases) despite one of them being a called THIRD strike -- Savant's
	// `des`/`result` fields describe the at-bat's final outcome, but this
	// specific pitch's own count fields are pre-pitch. The count actually
	// in effect once the challenge resolves needs the FINAL call (post-
	// challenge, already computed above) applied on top of that baseline --
	// a ball adds to balls, a strike adds to strikes, matching how a real
	// count is described (this can legitimately reach 0-3/4-1/etc. on the
	// deciding pitch of an at-bat, same as any real box score would show).
	var displayBalls = c.balls;
	var displayStrikes = c.strikes;
	if (hasCount) {
		if (finalCall === "Ball") {
			displayBalls = c.balls + 1;
		} else if (finalCall === "Strike") {
			displayStrikes = c.strikes + 1;
		}
	}

	return "Inning " + (c.half_inning === "top" ? "Top" : "Bottom") + " " + c.inning + ", " + c.outs + " out(s)<br>" +
		enyo.string.escapeHtml(c.batter_name || "") + " vs " + enyo.string.escapeHtml(c.pitcher_name || "") +
		(c.pitch_name ? " (" + enyo.string.escapeHtml(c.pitch_name) + ")" : "") + "<br>" +
		"Umpire call was " + enyo.string.escapeHtml(originalCall) + ".<br>" +
		enyo.string.escapeHtml(challengerRole || "Someone") + " challenged the call.<br>" +
		"Challenge " + (c.is_overturned ? "overturned" : "confirmed") + ": " + enyo.string.escapeHtml(finalCall) + "." +
		(hasCount ? "<br>Count is now " + displayBalls + "-" + displayStrikes + "." : "");
};

// Small plate-view diagram: where the pitch actually crossed relative
// to THIS batter's own strike zone for that at-bat. plate_x/plate_z
// (pitch's real crossing point) and sz_top/sz_bot (this batter's zone
// bounds) come straight from Savant's per-pitch data (all in feet) --
// see the service's getAbsChallengeEvents. Absent on some pitches (rare,
// but not guaranteed present) -- skip the diagram rather than draw a
// wrong one.
AbsChallengeFormat.buildPitchLocationHtml = function (c) {
	if (typeof c.plate_x !== "number" || typeof c.plate_z !== "number") {
		return "";
	}
	// View window a bit wider/taller than the zone itself, so pitches
	// that missed badly (the whole reason someone challenged) still
	// land inside the box instead of clipping off the edge.
	//
	// The X range here is DELIBERATELY narrower than the Z range (2.667ft
	// vs 3.2ft, not the same span) -- css/AbsStatsView.css's own
	// .pitchLocationBox is 100x120px (width:height = 0.8333:1, taller than
	// wide), so an EQUAL-feet window on both axes would render 1 real foot
	// as MORE pixels vertically than horizontally, visually stretching any
	// pitch's true distance from the zone edge whenever that pitch missed
	// mostly vertically vs mostly horizontally -- confirmed against two
	// real challenge pitches (2026-08-07, Angels @ Orioles game 824804):
	// both were genuinely only 1-2 inches from the nearest zone edge (per
	// Savant's own edge_distance field), which a mismatched-aspect window
	// would render as visibly farther than that for whichever axis had the
	// larger effective px/ft scale. 2.667 = 3.2 * (100/120), i.e. the X
	// span that gives this window the SAME aspect ratio as the box itself,
	// so a foot looks like the same number of pixels on both axes.
	var minX = -1.333, maxX = 1.333, minZ = 1.0, maxZ = 4.2;
	var szTop = (typeof c.sz_top === "number") ? c.sz_top : 3.4;
	var szBot = (typeof c.sz_bot === "number") ? c.sz_bot : 1.6;
	// Rule-book plate half-width (8.5in) plus a ball's radius (~1.45in)
	// -- the standard "any part of the ball touches the zone" margin.
	var halfZoneWidth = 0.83;

	var pct = function (v, lo, hi) {
		var p = (v - lo) / (hi - lo) * 100;
		return Math.max(0, Math.min(100, p));
	};

	var zoneLeft = pct(-halfZoneWidth, minX, maxX);
	var zoneRight = pct(halfZoneWidth, minX, maxX);
	var zoneTop = 100 - pct(szTop, minZ, maxZ);
	var zoneBottom = 100 - pct(szBot, minZ, maxZ);

	var dotLeft = pct(c.plate_x, minX, maxX);
	var dotTop = 100 - pct(c.plate_z, minZ, maxZ);

	// Dot color matches the FINAL call (post-challenge), same green/red
	// used for balls/strikes throughout the rest of Gameday (see
	// css/GamedayView.css's .pitchBall/.pitchStrike -- this diagram
	// isn't in that same view so it can't share the CSS rule directly,
	// but reuses the identical color values via .pitchDotBall/
	// .pitchDotStrike in css/AbsStatsView.css). Falls back to the
	// original neutral red if the final call is neither (shouldn't
	// happen -- call_name is always "Ball" or "Strike" in practice).
	var finalCall = AbsChallengeFormat.getFinalCall(c);
	var dotClass = (finalCall === "Ball") ? "pitchDotBall" : (finalCall === "Strike") ? "pitchDotStrike" : "";

	return '<div class="pitchLocationBox">' +
		'<div class="pitchStrikeZone" style="left:' + zoneLeft + '%;width:' + (zoneRight - zoneLeft) +
		'%;top:' + zoneTop + '%;height:' + (zoneBottom - zoneTop) + '%;"></div>' +
		'<div class="pitchDot ' + dotClass + '" style="left:' + dotLeft + '%;top:' + dotTop + '%;"></div>' +
		'</div>';
};

// One challenge as a full row (image column + divider + text column) --
// the same CSS-table technique as views/GamedayLinescore.js's scoreTable.
// Shared by mlb.AbsGameStats' full per-game list and
// mlb.GamedayChallengeDetail's single-challenge view.
AbsChallengeFormat.buildChallengeRowHtml = function (c) {
	return '<div class="challengeRow">' +
		'<div class="challengeImageCell">' + AbsChallengeFormat.buildPitchLocationHtml(c) + '</div>' +
		'<div class="challengeDivider"></div>' +
		'<div class="challengeTextCell">' + AbsChallengeFormat.buildChallengeTextHtml(c) + '</div>' +
		'</div>';
};
