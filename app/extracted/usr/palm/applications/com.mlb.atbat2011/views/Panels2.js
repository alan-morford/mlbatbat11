/* Copyright 2009-2011 Hewlett-Packard Development Company, L.P. All rights reserved. */

enyo
		.kind( {
			name : "mlb.Panels",
			kind : enyo.VFlexBox,
			components : [
			/*
			 * { kind : "VFlexBox", className : "enyo-fit", components : [ {
			 * kind : "Header" }, { kind : "Spacer" }, { kind : "Toolbar" } ] },
			 */
			{
				name : "slidingPane",
				kind : "SlidingPane",
				flex : 1,
				onResize:"resizeHandler",
				onSelectView : "slidingSelected",
				components : [
						{
							name : "leftSlidingView",
							width : "200px",
							components : [
									{
										name : "header",
										kind : "Header",
										components : [ {
											kind : "Image",
											src : "imgs/icons/mlb.png",
											style : "margin : 0 25px"
										} ]
									},
									{

										flex : 1,
										name : "leftNav",
										className : "leftNav",
										components : [],
										"itemClicked" : function(item) {


											if (this.lastItemClicked) {
												if (main.currentMiddlePane == item.properties.view) {
													return; // do nothing
												} else {
													this.lastItemClicked
															.removeClass("clicked");
												}
											}
											item.addClass("clicked");
											this.lastItemClicked = item;

											var showit = function() {

												var view = Views[item.properties.view];

												if (!view) {
													return;
												}
												view.params = item.properties.params;
												if (item.properties.view == "GenericWebView") {
													view.title = item.properties.title;
												}
												Views["Scoreboard"]
														.hidePopups();
												Views["Scoreboard"].$.scrim
														.hide();
												if (Views
														&& Views["Scoreboard"]) {
													try {
														Views["Scoreboard"]
																.scrollTo(0, 0);
													} catch (e) {
													}
												}
												main
														.showViewInMiddle(
																item.properties.view,
																Views[item.properties.view]);

											};

											showit();

											Track(item.properties.view);

										}

									}, {
										// Blocks taps on the left-nav item list while a
										// view has something in-progress that shouldn't
										// be interruptible by navigating away (currently
										// just views/VideosView.js's video download/
										// launch -- see main.setLeftNavBlocked, called
										// from that view's showPlaybackOverlay/
										// hidePlaybackOverlay). A SIBLING of "leftNav"
										// here, not a child declared INSIDE it -- leftNav's
										// own components are destroyComponents()'d and
										// rebuilt fresh every time Main.js's
										// configureLeftNav() runs (see that function), so
										// a child declared here would get silently wiped
										// out the first time that happens. Same purpose
										// and reasoning as the sibling `dailymotion`
										// project's own leftPaneBlocker -- a single
										// overlay confined inside a middle-pane view (see
										// views/VideosView.js's own playbackOverlay)
										// can't reach this far up the tree at all, this
										// menu lives entirely outside that view's own box.
										name : "leftNavBlocker",
										kind : "Control",
										className : "leftNavBlocker",
										// flex:0 explicitly -- this leftSlidingView
										// column already tripped this project's own
										// established FlexLayout gotcha once before
										// (see enyo_flex_and_slidingpane_gotchas):
										// an unset flex defaults to flex:1 even on a
										// position:absolute child, silently reserving
										// real vertical space in this column even
										// while showing:false.
										flex : 0,
										showing : false,
										onclick : "_swallowLeftNavClick"
									}, {
										kind : "Toolbar"
									} ]
						},
						{
							name : "rightPane",
							flex : 1,
							onResize:"resizeHandler",
							components : [ {
								kind : "Pane",
								name : "panes",
								flex : 1,
								style : "width:100%; height: 100%",
								transitionKind : "enyo.transitions.Fade",
								onSelectView : "viewSelected",
								components : [ {
									name : "FIRST",
									kind : "enyo.VFlexBox"
								},
										{
											kind : "mlb.ScoreboardView",
											name : "Scoreboard"

										},
										{
											kind : "mlb.NewsView",
											name : "News"

										},
										{
											flex : 1,
											kind : "mlb.AbsStatsView",
											name : "AbsStats"
										},
										{
											flex : 1,
											kind : "mlb.TeamsView",
											name : "Teams"
										},
										{
											flex : 1,
											kind : "mlb.ScheduleView",
											name : "Schedule"
										},
										{
											flex : 1,
											kind : "mlb.VideosView",
											name : "Videos"
										},
										{
											flex : 1,
											kind : "mlb.StandingsView",
											name : "Standings"
										// style: "width:100%; height: 500"

										},
										{
											flex : 1,
											// mlb.GamedayPane (not mlb.GamedayView directly) -- a thin
											// SlidingPane wrapper that adds the challenge-detail pane,
											// see views/GamedayView.js's own header comment on
											// mlb.GamedayPane for why the two are split.
											kind : "mlb.GamedayPane",
											name : "Gameday"
										},
										{
											flex : 1,
											// Shown instead of "Gameday" above when the tapped game is
											// already Final -- see views/GameSummaryView.js's own header
											// comment (mlb.GameSummaryPane is the outermost of 3 nested
											// SlidingPanes declared in that file). Not in
											// data/localExtras.js's leftnav, same as Gameday -- only
											// ever reached by tapping a game.
											kind : "mlb.GameSummaryPane",
											name : "GameSummary"
										},
										{
											flex : 1,
											kind : "mlb.TermsView",
											name : "Terms"
										// style: "width:100%; height: 500"

										},
										{
											flex : 1,
											kind : "mlb.GenericWebView",
											name : "GenericWebView"
										// style: "width:100%; height: 500"

										},
										{
											name : "slidingPane2",
											kind : "SlidingPane",
											components : [
													{
														name : "middleSlidingView",
														flex : 1,
														// peekWidth : 200,
														showing : false,

														onResize : "slidingResize",
														components : [ {
															name : "middleCanonView",
															kind : "CanonView",
															headerContent : "",
															flex : 1,
															components : []
														} ]
													},
													{
														name : "rightSlidingView",
														flex : 1,
														showing : false,

														onResize : "slidingResize",
														style : "background-color: rgba(1,1,1,0); ",
														components : [ {
															name : "rightCanonView",
															kind : "CanonView",
															headerContent : "Panel 3",
															flex : 1
														} ]

													}

											]
										}

								]
							} ]
						} ]
			} ],

			gotoMiddle : function() {
				// this.$.slidingPane.selectView(this.$.middleSlidingView);
		},
		itemClicked : function() {
			console.log("ITEM CLICKED!");
		},

		// leftNavBlocker's own onclick -- swallows a tap on the blocker
		// itself so it doesn't fall through to whatever's underneath.
		_swallowLeftNavClick : function() {
			return true;
		},

		slidingSelected : function(inSender, inSliding, inLastSliding) {
			// print(this.$.rightSlidingView);
			// print(this.$.slidingPane);
			console.log("SLIDING SELECTED!! lastslding:" + inLastSliding);
			if (inSliding.index == 0) {
				console.log("HIDE RIGHT SLIDING VIEW");
				// main.hideRightSlidingView();
			}

			this.log(inSliding.id, (inLastSliding || 0).id);
		},
		slidingResize : function(inSender) {
			console.log("SLIDING RESIZE!!");
			this.log(inSender.id);
		},
		backHandler : function(inSender, e) {
			console.log("BACK!!");
			// this.$.slidingPane.back(e);
		},
		resizeHandler : function() {
			console.log("RESIZE HANDLER!!");
			// this.$.slidingPane.resize();
		},
		viewSelected : function(inSender, inView) {

			inView.show();
		}
		});