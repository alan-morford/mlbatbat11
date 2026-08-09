// Scoreboard, rebuilt against MLB Stats API. The original view fetched a
// remote jQuery template (main.config.scoreboardUrls.template.*) at runtime
// and rendered games into it via jQuery.template() -- that template file was
// never part of the .ipk and no longer exists anywhere, so this is a native
// Enyo rewrite (views/ScoreboardGameBox.js, views/ScoreboardList.js), not a
// data-source swap. See lib/parsers/ScoreboardParser.js for the response
// mapping and lib/WebServices.js's ScoreboardStatsAPIService for the request.
var Months = [
	"January", "February", "March", "April", "May", "June", "July",
	"August", "September", "October", "November", "December"
];

enyo
		.kind( {
			name : "mlb.ScoreboardView",
			kind : "enyo.VFlexBox",
			flex : 1,
			published : {
				date : null,
				configDates : null
			},
			style : "background-color:#e7e7db",
			components : [
						// Also accessed directly as Views["Scoreboard"].$.scrim by
						// views/Panels2.js's left-nav itemClicked handler, uncaught --
						// must always exist.
						{
							kind : "Scrim",
							flex : 1,
							name : "scrim",
							onclick : "scrimClick",
							showing : false,
							style : "position:absolute;height:768px;top:50px;width:1024px;background-color:#333;"
						},
					{
						kind : "enyo.VFlexBox",
						flex:1,
						components : [ {
							flex:0,
							name : "scoreboardHeader",
							kind : "mlb.ScoreboardHeader"

						}, {
							kind : "Scroller",
							name: "scroller",
							flex:1,
							components : [ {
								kind : "mlb.ScoreboardList",
								name : "scoreboardList",
								flex : 1
							} ]
						},

						{
							flex:0,
							kind : "Toolbar",
							height : "40px",
							components : [ {
								kind : "GrabButton"
							} ]
						}

						]

					},

					{
						kind : "Popup",
						name : "audio",
						dismissWithClick : false,
						className : "audioPopup",
						style : "height:620px;width:430px; border:none; -webkit-border-image:none;",
						components : [ {
							name : "audioChrome",
							flex : 1,
							style : "height:618px;width:428px; background-color:transparent !important;border:none;"
						} ]
					},
					{
						name : "getScoreboard",
						kind : "ScoreboardStatsAPIService",
						onSuccess : "scoreboardReturn",
						onFailure : "scoreboardFailed"
					} ],
			// Called unconditionally by views/Panels2.js's left-nav
			// itemClicked handler before switching tabs, uncaught (unlike
			// its Views["Scoreboard"].scrollTo() call just above it, which
			// is wrapped in try/catch) -- must always exist as a real
			// method, not something only assigned after createOnce() runs.
			hidePopups : function() {
				// Used to unconditionally stopAudio() here too (dismissing
				// the audio popup previously left the background Luna
				// service playing indefinitely with no way to silence it
				// short of a device restart) -- but that's what
				// lib/AudioFlow.js's Dashboard notification-area widget is
				// for now (tap to pause, swipe to stop), and the explicit
				// point of that widget is to let the user keep navigating
				// the rest of the app (including other left-nav tabs)
				// without playback stopping out from under them. Just
				// close/hide this popup's own UI; playback itself is only
				// ever stopped by an explicit user action now (feed/date
				// change, or the Dashboard widget's own controls).
				this.$.audio.close();
				this.$.scrim.hide();
				this.$.scoreboardHeader.$.gamedayAudioButton.show();
				this.$.scoreboardHeader.$.DateNav.show();
				// Gameday is a full pane now, not a popup this method closes
				// -- but it's still the one place called on every left-nav
				// tap, so it's still the right place to stop Gameday's 15s
				// poll if you navigate away via the left nav instead of its
				// own back button (which already calls clearGameView()).
				if (Views["Gameday"] && Views["Gameday"].stopPolling) {
					Views["Gameday"].stopPolling();
				}
			},
			scrimClick : function() {
				this.hidePopups();
			},
			create : function() {
				this.inherited(arguments);
			},
			show : function() {
				this.createOnce();
				this.changeScoreboardDate(this.date);
			},
			createOnce : function() {
				if (this.created) {
					return;
				}
				this.configDates = this.getConfigDates();
				this.created = true;
			},
			getConfigDates : function() {
				return {
					"firstAllowedDay" : new Date(
							main.config.firstAllowedDay[0],
							main.config.firstAllowedDay[1] - 1,
							main.config.firstAllowedDay[2]),
					"lastAllowedDay" : new Date(
							main.config.lastAllowedDay[0],
							main.config.lastAllowedDay[1] - 1,
							main.config.lastAllowedDay[2]),
					"suggestedDay" : new Date(
							main.config.suggestedDay[0],
							main.config.suggestedDay[1] - 1,
							main.config.suggestedDay[2]),
					"openingDay" : new Date(main.config.openingDay[0],
							main.config.openingDay[1] - 1,
							main.config.openingDay[2])
				};
			},
			// grab the hash to pass to the schedule request
			changeScoreboardDate : function(date) {
				if (!date) {
					var d = new Date(),
						today = bam.datetime.DateTime(d).setTimeZone(-5, bam.datetime.isDST(d));
					date = (this.configDates != null
							&& this.configDates.suggestedDay.getTime() > today.getTime())
						? this.configDates.suggestedDay : today;
					if (date.getHours() < 10) {
						date.setDate(date.getDate() - 1);
					}
				}

				if (this.configDates != null) {
					if (date.getTime() < this.configDates.firstAllowedDay.getTime()) {
						date = bam.datetime.clone(this.configDates.firstAllowedDay);
					}
					if (date.getTime() > this.configDates.lastAllowedDay.getTime()) {
						date = bam.datetime.clone(this.configDates.lastAllowedDay);
					}
				}

				this.date = date;
				this.$.scoreboardHeader.$.gameDate.setContent(this.getDateString());
				this.$.scoreboardHeader.gameDate = date;
				this.$.scroller.scrollTo(0, 0);

				this.fetchScoreboard(date);
			},
			fetchScoreboard : function(date) {
				if (main.currentMiddlePane == "Scoreboard") {
					main.showMiddleSpinner();
				}

				var yyyy = date.getFullYear(),
					mm = ("0" + (date.getMonth() + 1)).slice(-2),
					dd = ("0" + date.getDate()).slice(-2);

				this.$.getScoreboard.urlParams = {
					"date" : yyyy + "-" + mm + "-" + dd
				};
				this.$.getScoreboard.call();
			},
			scoreboardReturn : function(inSender, inResponse) {
				main.hideMiddleSpinner();
				try {
					var parsed = ScoreboardParser.parseScoreboardFromStatsAPI(inResponse);
					this.$.scoreboardList.setGames(parsed.games);
				}
				catch (e) {
					console.log("scoreboardReturn parse error: " + e);
					this.$.scoreboardList.setGames([]);
				}
			},
			scoreboardFailed : function() {
				main.hideMiddleSpinner();
				this.$.scoreboardList.setGames([]);
			},
			openGamedayForGame : function(game) {
				// Final games open the Game Summary (score/box score/top
				// players/highlight video/recap) instead of the live Gameday
				// view -- see views/GameSummaryView.js. Its own
				// "Play-by-Play" button reaches this exact original Gameday
				// flow for anyone who still wants it, unchanged, for
				// in-progress/preview games.
				if (game.status && game.status.isFinal) {
					Views["GameSummary"].setGame(game);
					main.showViewInMiddle("GameSummary", Views["GameSummary"]);
					Track("GameSummary_Popup");
					return;
				}
				Views["Gameday"].setGame(game.gamePk, game.status.detailedState);
				main.showViewInMiddle("Gameday", Views["Gameday"]);
				Track("GameDay_Popup");
			},
			showGameDayAudio : function() {
				var leftPos = (jQuery("#" + this.$.scroller.id).width() > 1000) ? 280 : 400,
					topPos = (jQuery("#" + this.$.scroller.id).height() / 2 - 310) + 54;

				this.$.scoreboardHeader.$.gamedayAudioButton.hide();
				this.$.scoreboardHeader.$.DateNav.hide();
				this.$.scrim.show();
				this.$.audio.openAt( {
					top : topPos,
					left : leftPos
				});
				Views.Audio.renderInto(enyo.byId(this.$.audioChrome.id));
				Track("GameDayAudio_Popup");
			},
			// Called by views/AudioView.js to shrink the audio popup to just
			// fit its login form (no point showing a near-empty 620px-tall
			// popup while only a short login form is visible) and expand it
			// back once the game/feed list is showing. Width stays fixed --
			// only asked to fix the wasted vertical space, and the login
			// fields already flex to the existing width fine.
			resizeAudioPopup : function(height) {
				var leftPos = (jQuery("#" + this.$.scroller.id).width() > 1000) ? 280 : 400,
					topPos = (jQuery("#" + this.$.scroller.id).height() / 2 - height / 2) + 54;
				this.$.audio.applyStyle("height", height + "px");
				this.$.audio.applyStyle("top", topPos + "px");
				this.$.audio.applyStyle("left", leftPos + "px");
				this.$.audioChrome.applyStyle("height", (height - 2) + "px");
			},
			getDateString : function() {
				var date = (arguments.length > 0) ? arguments[0] : this.date;
				return Months[date.getMonth()] + " " + date.getDate() + ", "
						+ date.getFullYear();
			}
		});

enyo
		.kind( {
			name : "mlb.ScoreboardHeader",
			kind : "Header",
			published : {
				gameDate : null
			},
			components : [ {
				kind : enyo.HFlexBox,
				flex : 1,
				components : [ {
					kind : "CustomButton",
					className : "gamedayAudio",
					name : "gamedayAudioButton",
					onclick : "gameDayAudioClick",
					components : [ {
						kind : "Image",
						src : "imgs/icons/audio.png"
					} ]
				} ]
			}, {
				name : "DateNav",
				flex : 1,
				layoutKind : "HFlexLayout",
				components : [ {
					kind : "CustomButton",
					className : "calendar",
					onclick : "calendarButtonClick",
					components : [ {
						kind : "Image",
						src : "imgs/icons/calendar_26x25.png"
					} ]
				}, {
					kind : "CustomButton",
					onclick : "previousButtonClick",
					className : "prevButton",
					components : [ {
						kind : "Image",
						src : "imgs/previous.png"
					} ]
				}, {
					name : "gameDate",
					className : "gameDate"
				}, {
					kind : "CustomButton",
					onclick : "nextButtonClick",
					className : "nextButton",
					components : [ {
						kind : "Image",
						src : "imgs/next.png"
					} ]
				}, {
					kind : "Popup",
					name : "Calendar",
					components : [ {
						kind : "DatePicker",
						name : "datePicker",
						label : "Select Game Date",
						onChange : "calendarChange"
					}, {
						kind : "Button",
						caption : "OK",
						onclick : "selectDate"
					}, {
						kind : "Button",
						caption : "Back To Today",
						onclick : "selectToday"
					} ]
				} ]
			}, {
				kind : enyo.HFlexBox,
				flex : 1,
				name : "spacer"
			} ],
			previousButtonClick : function() {
				var currentDate = new Date(this.$.gameDate.getContent()),
					newDate = bam.datetime.clone(currentDate);
				newDate.setDate(currentDate.getDate() - 1);
				this.gameDate = newDate;
				this.owner.changeScoreboardDate(newDate);
			},
			nextButtonClick : function() {
				var currentDate = new Date(this.$.gameDate.getContent()),
					newDate = bam.datetime.clone(currentDate);
				newDate.setDate(currentDate.getDate() + 1);
				this.gameDate = newDate;
				this.owner.changeScoreboardDate(newDate);
			},
			calendarButtonClick : function(sender) {
				this.$.Calendar.openAtControl(sender);
				if (this.gameDate) {
					this.$.datePicker.setValue(this.gameDate);
				}
			},
			calendarChange : function() {
				this.gameDate = this.$.datePicker.getValue();
			},
			selectDate : function() {
				this.$.Calendar.close();
				this.owner.changeScoreboardDate(this.gameDate);
			},
			selectToday : function() {
				var d = new Date(), newDate = bam.datetime.DateTime(d)
						.setTimeZone(-5, bam.datetime.isDST(d));
				this.$.Calendar.close();
				this.owner.changeScoreboardDate(newDate);
				this.gameDate = newDate;
			},
			gameDayAudioClick : function() {
				this.owner.showGameDayAudio();
			}
		});
