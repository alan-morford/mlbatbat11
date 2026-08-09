// Live radio (game + feed list, login form, play/pause controls), rebuilt
// against MLB Stats API's broadcasts hydrate and the new lib/AudioFlow.js.
// The original view fetched ScoreboardService's dead XML feed and read
// game.audio.afeed -- see lib/WebServices.js's ScoreboardBroadcastsAPIService
// and lib/parsers/BroadcastsParser.js for the live replacement. Rendered
// into a popup opened from views/ScoreboardView.js's showGameDayAudio() (the
// header's audio icon button) -- that wiring was already in place and is
// unchanged here.
enyo
		.kind( {
			name : "mlb.AudioItem",
			kind : enyo.HFlexBox,
			published : {
				audioData : null,
				game : null
			},
			components : [ {
				name : "gameTitle",

				style : "width:70%"

			}, {
				name : "gameStatus",
				style : "width:30%; text-align:right"
			}

			],
			style : "height: 40px; padding: 10px; border-top: 1px solid #666; border-bottom: 1px solid black",
			rendered : function() {

				this.inherited(arguments);
				this.childrenRendered();

			}
		});

enyo
		.kind( {
			name : "mlb.AudioView",
			kind : enyo.VFlexBox,
			flex : 1,

			style : "margin-left:5px; margin-top: 5px; color: white; width: 421px; background-color:#2B2B2A; border-top-left-radius: 5px; border-top-right-radius:5px; -webkit-box-shadow: 0px 0px 5px #000; ",
			published : {
				date : null,
				pendingDate : null,
				currentlySelectedFeedButton : null,
				initialized:false,
				scoreboardFetched:false,
				// Which view opened this popup this time -- defaults to
				// Views["Scoreboard"] (see resizePopup) so the original
				// caller (views/ScoreboardView.js's showGameDayAudio) needs
				// no changes at all. views/GamedayView.js's openAudioPopup
				// sets this to itself instead, since this same singleton
				// view gets renderInto'd into whichever host's chrome div
				// asked for it.
				hostView : null,
				// Gameday-only behavior: close the whole host popup the
				// instant a feed is tapped, instead of this view's normal
				// in-popup "now playing" controls -- Gameday relies purely
				// on the notification-area Dashboard widget for playback
				// feedback, it has no in-place player UI of its own.
				// Scoreboard's own popup never sets this, so its existing
				// behavior is completely unaffected.
				closeOnFeedSelect : false,
				// Set by views/GamedayView.js right before renderInto so
				// this view skips straight to the feed-button row for
				// whatever game Gameday is already showing, instead of
				// requiring an extra tap on a game in the list first.
				// Cleared once consumed (see trySelectPendingGame) so a
				// later 15s list refresh or manual game tap doesn't keep
				// snapping back to it.
				autoSelectGamePk : null,
				// Gameday-only (see openAudioPopup) -- hides the game list/
				// date-nav entirely, showing just the top status/play-pause
				// box and the feed-button row for whichever single game was
				// auto-selected. Scoreboard's own popup never sets this, so
				// its normal browse-every-game-with-a-broadcast list is
				// unaffected.
				compactMode : false,
				// Estimate, not pixel-measured against a real device --
				// buttonAndStatusBox's own declared height (103px) + a
				// visible chunk of buttonToolbar (40px) + the popup's own
				// padding/border. Expect a follow-up tuning pass once seen
				// on-device (same caveat as LOGIN_POPUP_HEIGHT below, which
				// was original to this file already).
				COMPACT_HEIGHT : 175,
				// Reduced from 300 -- per direct user feedback (screenshot),
				// loginBox's actual content (title/error/2 inputs/remember-me
				// row/button row + padding) didn't come close to filling
				// 300px, leaving a visibly tall popup with empty space below
				// the buttons even after loginBox itself was made flex:1 (see
				// that component's own comment) to fix the two-tone color
				// gap. Still an estimate, not pixel-measured against a real
				// device -- expect a follow-up tuning pass once seen
				// on-device.
				LOGIN_POPUP_HEIGHT : 250,
				ROW_HEIGHT : 62, // mlb.AudioItem's own rendered height: 40px content + 10px top/bottom padding + 1px top/bottom border -- see updateMoreGamesHint
				// MLB Stats API's abstractGameState stays "Preview" for a
				// game's entire day up until first pitch, with no field
				// telling us when pregame radio coverage itself actually
				// starts -- estimate it ourselves rather than showing
				// "Pregame" (implying there's something to listen to right
				// now) for every game on the slate as soon as the day's
				// schedule loads. See isInPregameWindow.
				PREGAME_WINDOW_MINUTES : 45
			},
			components : [
					{
						name : "buttonAndStatusBox",
						kind : enyo.HFlexBox,
						style : "padding: 20px; height:103px; background-image: url(imgs/audio/hp_scoreboard_audio_base.png);  border-top-left-radius: 5px; border-top-right-radius:5px;",
						components : [
								{
									kind : "CustomButton",
									name : "actionButton",
									onclick : "actionButtonClick",
									value: "play",
									style : "height: 54px; width: 61px; padding:0; margin-right: 10px; background-image: url(imgs/audio/btn_play.png);"
								},

								{
									kind : "Scroller",
									name : "statusBox",
									style : "height: 45px; margin-left:4px; margin-top:5px; width:305px",
									components : [
											{
												name : "status",
												content : ""
											},
											{
												name : "feedName",
												content : "",
												style : "font-weight:bold; padding-top:5px"

											} ]
								}

						]

					},
					// Date navigation for historical (archived) broadcasts --
					// MLB's broadcasts hydrate already returns MEDIA_ARCHIVE
					// feeds for past games with availableForStreaming:true
					// (confirmed live, see lib/parsers/BroadcastsParser.js);
					// this is just UI to pick a date other than today. Only
					// shown once logged in (part of the list UI, hidden
					// along with it by refreshLoginGate while on the login
					// screen). DatePicker/Popup usage mirrors the already-
					// proven pattern in views/ScoreboardView.js's
					// mlb.ScoreboardHeader (calendarButtonClick/
					// calendarChange/selectDate/selectToday there).
					{
						name : "dateNavBox",
						kind : enyo.HFlexBox,
						showing : false,
						// width:100%/box-sizing:border-box -- without an
						// explicit width this box shrinks to its own content
						// (just the buttons + label, well short of the
						// popup's full width) and sits left-aligned instead
						// of stretching to match the game list below it,
						// which is what actually made it look "off to the
						// side". border-box keeps the horizontal padding
						// from pushing the total rendered width past 100%.
						style : "height:32px; padding:4px 10px; background-color:#1c1c1b; width:100%; box-sizing:border-box;",
						components : [
							{
								kind : "CustomButton",
								onclick : "previousDateClick",
								caption : "<",
								// line-height:height -- CustomButton (unlike
								// the feed buttons below) puts its caption
								// directly on its own node, so this alone is
								// enough to vertically center a single line
								// of text in a fixed-height box.
								style : "width:26px; height:24px; line-height:24px; background-color:#444; color:#fff; text-align:center; border-radius:3px;"
							},
							{
								name : "dateLabel",
								content : "Today",
								flex : 1,
								style : "color:#ccc; text-align:center; line-height:24px;"
							},
							{
								kind : "CustomButton",
								onclick : "nextDateClick",
								caption : ">",
								style : "width:26px; height:24px; line-height:24px; background-color:#444; color:#fff; text-align:center; border-radius:3px;"
							},
							{
								kind : "CustomButton",
								name : "calendarButton",
								onclick : "calendarButtonClick",
								caption : "Pick Date",
								style : "width:76px; height:24px; margin-left:8px; background-color:#444; color:#fff; text-align:center; border-radius:3px; font-size:0.75rem; line-height:24px;"
							},
							{
								kind : "Popup",
								name : "audioCalendar",
								components : [
									{
										kind : "DatePicker",
										name : "audioDatePicker",
										label : "Select Date",
										onChange : "calendarChange"
									},
									{
										kind : "Button",
										caption : "OK",
										onclick : "selectDate"
									},
									{
										kind : "Button",
										caption : "Today",
										onclick : "selectToday"
									}
								]
							}
						]
					},
					// Shown only while lib.AudioFlow's status is NeedsLogin/
					// LoggingIn/LoginFailed -- ROPC (MLB's login grant type)
					// has no browser redirect step, so this is just a plain
					// native form, no OAuth-broker relay needed. Gates the
					// WHOLE popup: streaming can't work without a real
					// MLB.com login either way, so this is shown instead of
					// (not alongside) the game/feed list until logged in --
					// see refreshLoginGate(). Kind names/properties here
					// ("Input", "PasswordInput", autoCapitalize,
					// inputClassName) are taken directly from the real Enyo
					// 1.0 framework source
					// (SDK/share/framework/enyo/1.0/framework/source/base/
					// controls/Input.js and palm/controls/input/
					// PasswordInput.js), not guessed -- PasswordInput is a
					// dedicated kind (real character masking, and already
					// sets autoCapitalize/autocorrect/spellcheck off by
					// default), not an "Input" with a made-up type property.
					{
						name : "loginBox",
						kind : enyo.VFlexBox,
						showing : false,
						// flex:1 -- per direct user feedback (screenshot),
						// without this loginBox only took up its own content
						// height, leaving a visible gap of mlb.AudioView's
						// own lighter background (#2B2B2A) between the
						// bottom of the login form and the popup's actual
						// (taller) declared LOGIN_POPUP_HEIGHT -- looked like
						// an unused thick grey bar. Filling the whole popup
						// with loginBox's own darker background (#1c1c1b)
						// removes that gap regardless of exactly how tall
						// LOGIN_POPUP_HEIGHT is tuned to.
						flex : 1,
						style : "padding: 15px 20px; background-color:#1c1c1b;",
						components : [
							{
								name : "loginTitle",
								content : "Log in with your MLB.com account to listen to live radio",
								style : "color:#ccc; padding-bottom:10px;"
							},
							{
								name : "loginError",
								content : "",
								style : "color:#e04040; padding-bottom:8px; font-weight:bold;"
							},
							{
								name : "usernameInput",
								kind : "Input",
								className : "mlbLoginInputBox",
								hint : "MLB.com username",
								autoCapitalize : "lowercase",
								autocorrect : false,
								spellcheck : false,
								inputClassName : "mlbLoginInput",
								style : "width:100%; margin-bottom:8px;"
							},
							{
								name : "passwordInput",
								kind : "PasswordInput",
								className : "mlbLoginInputBox",
								hint : "Password",
								inputClassName : "mlbLoginInput",
								style : "width:100%; margin-bottom:8px;"
							},
							{
								kind : enyo.HFlexBox,
								// height matches CheckBox's own native
								// 31px (Onyx/css/CheckBox.css) -- per direct
								// user feedback the label text wasn't
								// vertically centered on the checkbox despite
								// -webkit-box-align:center here; giving the
								// row an explicit height matching the
								// checkbox and the label a matching
								// line-height centers it by construction
								// instead of relying on cross-axis align
								// alone to do it.
								style : "-webkit-box-align:center; height:31px; margin-bottom:8px;",
								components : [ {
									name : "rememberMeCheckbox",
									kind : "CheckBox"
								}, {
									content : "Remember me",
									style : "color:#ccc; margin-left:6px; line-height:31px;",
									// Tapping the LABEL text should toggle the
									// checkbox too, not just the tiny box itself
									// -- a plain onclick forwarding to the
									// checkbox's own click handling is the
									// simplest way to widen that hit target.
									onclick : "rememberMeLabelClick"
								} ]
							},
							{
								// Cancel + Log In side by side, centered as a
								// pair -- per direct user feedback. pack:center
								// on this row (not e.g. individual margins) so
								// they stay centered as a unit regardless of
								// either button's own width.
								kind : enyo.HFlexBox,
								pack : "center",
								style : "margin-top:4px;",
								components : [ {
									// Real webOS "negative" (red) button --
									// same reasoning as loginSubmitButton's own
									// comment below: kind:"Button" +
									// .enyo-button-negative is the SAME red
									// webOS uses for its own native
									// destructive/cancel actions (confirmed
									// against the real theme CSS,
									// palm/themes/Onyx/css/Button.css --
									// background-color:#be0003, white text).
									kind : "Button",
									className : "enyo-button-negative",
									caption : "Cancel",
									onclick : "loginCancelClick",
									style : "width:100px; margin-right:10px;"
								}, {
									// Real webOS "affirmative" (green) button --
									// kind:"Button" (not CustomButton, which is
									// explicitly "a button without any visual
									// treatment" per its own Enyo 1.0 framework
									// doc comment) auto-applies the framework's
									// own .enyo-button base class (pill shape,
									// border-image chrome); .enyo-button-affirmative
									// on top of that is the SAME green webOS uses
									// for its own native affirmative actions
									// (confirmed against the real theme CSS,
									// palm/themes/Onyx/css/Button.css --
									// background-color:#2aa100, white text), not a
									// made-up color. No custom inline background
									// needed anymore; just enough style to size it.
									kind : "Button",
									name : "loginSubmitButton",
									className : "enyo-button-affirmative",
									caption : "Log In",
									onclick : "loginSubmitClick",
									style : "width:100px;"
								} ]
							}
						]
					},
					{
						kind : "Toolbar",
						name: "buttonToolbar",
						style : "width:100%; height:40px;",
						showing: false,
						components : [

						               {
							name : "feedList",
							kind : "RadioToolButtonGroup",
							style : "height:40px; width: 90%;",

							components : [


							{
								name : "feed1",
								value: "feed1",
								caption: "feed1",
								onclick : "feedClicked",
								allowHtml : true,
								showing : false,
								className : "mlbFeedButton",
								// height:32px -- .enyo-grouped-toolbutton has
								// no fixed height of its own (just 15px of
								// vertical padding around whatever the
								// caption's natural line-height is), so it
								// was rendering shorter than this 40px
								// toolbar row and sitting at the top of it.
								// An explicit height here, matched by
								// .mlbFeedButton .enyo-button-icon-text's
								// line-height in AudioView.css, is what
								// actually centers the caption -- text-align
								// alone only ever handled the horizontal axis.
								style: "font-size:100%; width:80px; height:32px;"


							}, {
								name : "feed2",
								value: "feed2",
								caption: "feed2",
								onclick : "feedClicked",
								allowHtml : true,
								showing : false,
								className : "mlbFeedButton",
								// height:32px -- .enyo-grouped-toolbutton has
								// no fixed height of its own (just 15px of
								// vertical padding around whatever the
								// caption's natural line-height is), so it
								// was rendering shorter than this 40px
								// toolbar row and sitting at the top of it.
								// An explicit height here, matched by
								// .mlbFeedButton .enyo-button-icon-text's
								// line-height in AudioView.css, is what
								// actually centers the caption -- text-align
								// alone only ever handled the horizontal axis.
								style: "font-size:100%; width:80px; height:32px;"
							}, {
								name : "feed3",
								value: "feed3",
								caption: "feed3",
								onclick : "feedClicked",
								allowHtml : true,
								showing : false,
								className : "mlbFeedButton",
								// height:32px -- .enyo-grouped-toolbutton has
								// no fixed height of its own (just 15px of
								// vertical padding around whatever the
								// caption's natural line-height is), so it
								// was rendering shorter than this 40px
								// toolbar row and sitting at the top of it.
								// An explicit height here, matched by
								// .mlbFeedButton .enyo-button-icon-text's
								// line-height in AudioView.css, is what
								// actually centers the caption -- text-align
								// alone only ever handled the horizontal axis.
								style: "font-size:100%; width:80px; height:32px;"
							}, {
								name : "feed4",
								value: "feed4",
								caption: "feed4",
								onclick : "feedClicked",
								allowHtml : true,
								showing : false,
								className : "mlbFeedButton",
								// height:32px -- .enyo-grouped-toolbutton has
								// no fixed height of its own (just 15px of
								// vertical padding around whatever the
								// caption's natural line-height is), so it
								// was rendering shorter than this 40px
								// toolbar row and sitting at the top of it.
								// An explicit height here, matched by
								// .mlbFeedButton .enyo-button-icon-text's
								// line-height in AudioView.css, is what
								// actually centers the caption -- text-align
								// alone only ever handled the horizontal axis.
								style: "font-size:100%; width:80px; height:32px;"
							}
							]

						} ]
					},

					{
						kind : "VirtualList",
						flex : 1,
						name : "list",
						onSetupRow : "listSetupRow",

						components : [ {
							kind : "mlb.AudioItem",
							onclick : "audioItemClick"
						} ]
					},

					// Static "more games below/above" indicator, arrow only
					// (no label) -- shown/hidden by comparing this.games.length
					// against how many rows actually fit in the list's
					// rendered height (see updateMoreGamesHint). Direction
					// flipped by updateArrowDirection, fed by a patch onto
					// VirtualList's own adjustTop/adjustBottom -- see that
					// patch's comment (in rendered()) for why it's wired this
					// indirect way instead of a normal scroll listener.
					{
						name : "moreGamesHint",
						content : "▼",
						showing : false,
						style : "height:20px; line-height:20px; text-align:center; font-size:16px; color:#999; background-color:#1c1c1b;"
					},

					{
						name : "broadcastsService",
						kind : "ScoreboardBroadcastsAPIService",
						onSuccess : "broadcastsServiceReturn"
					},
					// "Remember me" credential storage -- see
					// com.mlb.atbat2011.service/MLBAudioService.js's
					// rememberCredentials/getRememberedCredentials/
					// forgetCredentials for why this lives in the service
					// (openssl-encrypted, with the key kept only in the
					// service's own storage) rather than this app's own
					// localStorage.
					{
						name : "rememberCredentialsCmd",
						kind : "PalmService",
						service : "palm://com.mlb.atbat2011.service/",
						method : "rememberCredentials"
					},
					{
						name : "getRememberedCredentialsCmd",
						kind : "PalmService",
						service : "palm://com.mlb.atbat2011.service/",
						method : "getRememberedCredentials",
						onSuccess : "gotRememberedCredentials"
					},
					{
						name : "forgetCredentialsCmd",
						kind : "PalmService",
						service : "palm://com.mlb.atbat2011.service/",
						method : "forgetCredentials"
					}
			],
			create : function() {
				console.log("Create AudioView");
				this.games = [];
				this.inherited(arguments);

			},
			rendered : function() {
				this.node = enyo.byId(this.id);
				this.inherited(arguments);
				this.childrenRendered();

				if (!this.initialized) {
					this.initialized = true;

					var _self = this;
					main.$.audioFlow.addFlowListener("audioView", function(message)  {
						_self.applyFlowMessage(message);
					});

					// Patch (don't replace) VirtualList's own adjustTop/
					// adjustBottom -- see updateArrowDirection's comment.
					// These fire with the row-index range VirtualList
					// currently has buffered/visible, straight from its own
					// internal bookkeeping, which is a far lower-risk way to
					// learn "is the user at the bottom of the list" than
					// swapping out the list's rendering mechanism was.
					var origAdjustTop = this.$.list.adjustTop;
					var origAdjustBottom = this.$.list.adjustBottom;
					this.$.list.adjustTop = function(inSender, inTop) {
						origAdjustTop.apply(this, arguments);
						_self.listTopRow = inTop;
						_self.updateArrowDirection();
					};
					this.$.list.adjustBottom = function(inSender, inBottom) {
						origAdjustBottom.apply(this, arguments);
						_self.listBottomRow = inBottom;
						_self.updateArrowDirection();
					};
				}

				this.wirePasswordEnterKey();
				this.refreshLoginGate();
			},

			// Enter-to-submit in the password field. NOT done via Input's
			// own onkeypress event property: checked the real framework
			// source (base/controls/BasicInput.js) and its create() only
			// wires onfocus/onblur to actual DOM listeners
			// (enyo.mixin(this.domAttributes, {onfocus:..., onblur:...})) --
			// onkeypress is declared in the events block but never actually
			// connected to the DOM keypress event in this Enyo version, so
			// binding onkeypress in the component declaration silently does
			// nothing. Attaching a raw DOM listener directly to the
			// underlying <input> node (via the Input kind's own "input"
			// chrome child) is the only thing that actually works. Re-run
			// on every render, not just the first, in case the popup's DOM
			// gets torn down and rebuilt on a later open.
			wirePasswordEnterKey : function() {
				var inputNode = this.$.passwordInput.$.input;
				if (!inputNode || !inputNode.hasNode()) {
					return;
				}
				var _self = this;
				inputNode.node.onkeypress = function(e) {
					e = e || window.event;
					if ((e.keyCode || e.which) == 13) {
						_self.loginSubmitClick();
					}
				};
			},

			// The popup this view renders into is a fixed-size Popup owned
			// by whichever view last called renderInto (views/ScoreboardView.js's
			// showGameDayAudio, or views/GamedayView.js's openAudioPopup) --
			// shrinking/expanding it needs reaching into THAT view's own
			// resizeAudioPopup(), not just resizing something inside this
			// one, since this view's own root is confined to whatever size
			// its parent chrome div already is. Falls back to
			// Views["Scoreboard"] when hostView isn't set, preserving the
			// original caller's behavior unchanged.
			resizePopup : function(height) {
				var host = this.hostView || Views["Scoreboard"];
				if (host && host.resizeAudioPopup) {
					host.resizeAudioPopup(height);
				}
			},

			// Mirrors resizePopup's own hostView-or-Scoreboard fallback --
			// the two hosts don't share a close method NAME though
			// (views/GamedayView.js's mlb.GamedayPane has closeAudioPopup,
			// views/ScoreboardView.js's mlb.ScoreboardView has hidePopups),
			// so both are tried.
			closePopup : function() {
				var host = this.hostView || Views["Scoreboard"];
				if (host && host.closeAudioPopup) {
					host.closeAudioPopup();
				} else if (host && host.hidePopups) {
					host.hidePopups();
				}
			},

			// Cancel on the login form -- there's no "go back" state to
			// return to (login is a hard gate on the whole popup, not one
			// screen among several), so the only sensible action is closing
			// the popup entirely, same as tapping the scrim behind it.
			loginCancelClick : function() {
				this.closePopup();
			},

			// Gates the whole popup on login: shows only the login form
			// until MLBAuth has a cached token, then reveals the normal
			// game/feed list UI (fetching the game list for the first time
			// right when it's first revealed, not before -- and only once
			// per popup lifetime, since re-opening the popup after already
			// being logged in shouldn't re-trigger a fresh fetch + a second
			// concurrent 15s poll loop on top of the still-running one).
			//
			// If the access token has expired but a refresh token is still
			// cached (see lib/AudioFlow.js's attemptSilentAuth), try that
			// silently before falling back to the password form -- this is
			// what actually fixes "have to log in again after a few days",
			// since the access token alone only lasts about an hour and this
			// gate is the very first thing that runs on every popup open.
			refreshLoginGate : function() {
				if (MLBAuth.getCachedToken()) {
					this.showLoggedInUI();
					return;
				}
				if (MLBAuth.getCachedRefreshToken()) {
					this.$.loginBox.hide();
					this.$.buttonAndStatusBox.hide();
					this.$.dateNavBox.hide();
					this.$.buttonToolbar.hide();
					this.$.list.hide();
					// Resize NOW, not just once attemptSilentAuth's callback
					// fires -- confirmed live this is why the Gameday audio
					// popup sometimes opened oversized: the access token
					// lasts about an hour (see this method's own header
					// comment), so any open after that needs this silent
					// refresh-token exchange, a real network round-trip with
					// no fixed latency. Every OTHER path through this method
					// resizes immediately (showLoggedInUI/showLoginForm both
					// call resizePopup synchronously), so this was the one
					// gap where the popup just sat at whatever size it
					// happened to already be -- its own declared 620px
					// default, or a stale size left over from this same
					// singleton view's last use elsewhere (e.g. the full
					// Scoreboard-hosted popup) -- for however long the
					// network call took. Sizing to the eventual target now
					// (matching showLoggedInUI's own compactMode check)
					// means there's nothing left to visibly jump once the
					// real content shows.
					this.resizePopup(this.compactMode ? this.COMPACT_HEIGHT : 620);
					var _self = this;
					main.$.audioFlow.attemptSilentAuth(function(success) {
						if (success) {
							_self.showLoggedInUI();
						} else {
							_self.showLoginForm();
						}
					});
					return;
				}
				this.showLoginForm();
			},

			showLoggedInUI : function() {
				this.$.loginBox.hide();
				this.$.buttonAndStatusBox.show();
				if (this.compactMode) {
					this.$.dateNavBox.hide();
					this.$.list.hide();
					this.$.moreGamesHint.hide();
					this.resizePopup(this.COMPACT_HEIGHT);
				}
				else {
					this.$.dateNavBox.show();
					this.$.list.show();
					this.resizePopup(620);
				}
				// Also re-fetch (not just re-use this.games) whenever there's
				// a pending Gameday auto-select, even if scoreboardFetched is
				// already true -- confirmed live this is why the Gameday
				// popup sometimes opened compact but with no channel buttons
				// at all: this.games could be left over from an EARLIER open
				// on the same calendar day (a different game, or the same
				// game before its broadcast was registered yet), and
				// trySelectPendingGame below only ever gets ONE chance to
				// match against whatever list it's given -- if that list is
				// stale and doesn't include this game's feeds, it fails
				// silently and clears the pending flag, so no later fetch
				// ever retries it. A fresh fetch is cheap and guarantees
				// broadcastsServiceReturn's own trySelectPendingGame call
				// (not this one) is what actually finds it.
				if (!this.scoreboardFetched || this.autoSelectGamePk) {
					this.scoreboardFetched = true;
					this.updateDateLabel();
					this.fetchScoreboard();
				}
				else {
					// Games for this date are already loaded from a prior
					// open, and there's no pending auto-select to worry about
					// being stale for -- still worth re-checking in case a
					// manual date-nav interaction left something pending
					// some other way.
					this.trySelectPendingGame();
				}
			},
			showLoginForm : function() {
				this.$.loginBox.show();
				this.$.buttonAndStatusBox.hide();
				this.$.dateNavBox.hide();
				this.$.buttonToolbar.hide();
				this.$.list.hide();
				this.$.loginError.setContent("");
				this.resizePopup(this.LOGIN_POPUP_HEIGHT);
				// Pre-fill from whatever's remembered, if anything -- every
				// time the login form shows, not just the first, since a
				// LATER login (different credentials, or unchecking
				// remember me) can change what's stored between one show
				// and the next.
				this.$.getRememberedCredentialsCmd.call();
			},

			gotRememberedCredentials : function(inSender, inResponse) {
				if (!inResponse || !inResponse.returnValue || !inResponse.found) {
					return;
				}
				this.$.usernameInput.setValue(inResponse.username || "");
				this.$.passwordInput.setValue(inResponse.password || "");
				// setChecked (programmatic) deliberately does NOT fire
				// CheckBox's own onChange -- see enyo.CheckBox's own doc
				// comment -- so this can't accidentally trigger anything
				// else that might be wired to that event later.
				this.$.rememberMeCheckbox.setChecked(true);
			},

			rememberMeLabelClick : function() {
				this.$.rememberMeCheckbox.setChecked(!this.$.rememberMeCheckbox.getChecked());
			},

			applyFlowMessage : function(message) {
				this.$.status.setContent( message.statusMessage);
				this.$.feedName.setContent(message.feedName);

				// Safety net: a feed was tapped but the cached token had
				// expired since the up-front login (see lib/AudioFlow.js's
				// submitLogin/needsLogin doc comments) -- re-show the login
				// gate rather than a login form buried in the now-hidden
				// game list UI.
				if (message.status == "NeedsLogin") {
					this.refreshLoginGate();
					return;
				}

				if(message.status=="NowPlaying") {
					this.$.actionButton.value="pause";
					this.$.actionButton.applyStyle("background-image",
					"url(imgs/audio/btn_pause.png)");
				}
				else if(message.status=="PlaybackError") {
					this.$.actionButton.value="play";
					this.$.actionButton.applyStyle("background-image",
					"url(imgs/audio/btn_play.png)");
					// Deliberately no auto-retry here -- a prior version
					// retried the same feed every 1s with no limit, which
					// against a persistent failure (e.g. an MLB-side
					// entitlement/session limit) meant it just hammered the
					// API forever with no user action. Show the error and
					// wait for an explicit tap.
				}
				else {
					this.$.actionButton.value="play";
					this.$.actionButton.applyStyle("background-image",
					"url(imgs/audio/btn_play.png)");
				}

			},

			loginSubmitClick : function() {
				var username = this.$.usernameInput.getValue();
				var password = this.$.passwordInput.getValue();
				if (!username || !password) {
					this.$.loginError.setContent("Please enter both a username and password.");
					return;
				}
				this.$.loginError.setContent("");
				this.$.status.setContent("Logging in...");

				var rememberMe = this.$.rememberMeCheckbox.getChecked();
				var _self = this;
				main.$.audioFlow.login(username, password, function(success) {
					_self.$.passwordInput.setValue("");
					if (success) {
						// Only store on an actually-successful login --
						// never persist credentials that just failed.
						// Checking the box with nothing (or stale/wrong
						// values) previously remembered and then unchecking
						// it is the "forget" path.
						if (rememberMe) {
							_self.$.rememberCredentialsCmd.call({ username : username, password : password });
						} else {
							_self.$.forgetCredentialsCmd.call();
						}
						_self.refreshLoginGate();
					}
					else {
						// main.$.audioFlow.statusMessage was just set by
						// oktaTokenReturn/oktaTokenFailed to something more
						// specific than a generic message -- e.g. Okta's own
						// error_description, or a network/CORS hint distinct
						// from "wrong password" (see lib/AudioFlow.js).
						_self.$.loginError.setContent(main.$.audioFlow.statusMessage);
					}
				});
			},

			// See PREGAME_WINDOW_MINUTES. gameDate is MLB Stats API's ISO8601
			// UTC first-pitch time, directly parseable by Date. No lower
			// bound on how late this can be -- a delayed/postponed game
			// whose gameDate has already passed while it's still isPreview
			// should keep showing "Pregame", not fall back to "Scheduled".
			isInPregameWindow : function(gameDateIso) {
				var minutesUntilFirstPitch = (new Date(gameDateIso).getTime() - Date.now()) / 60000;
				return minutesUntilFirstPitch <= this.PREGAME_WINDOW_MINUTES;
			},

			listSetupRow : function(inSender, inIndex) {

				if(this.games.length == 0 && inIndex==0) {
					this.$.audioItem.$.gameTitle
					.setContent("No games/feeds currently available");
					return true;
				}

				if (inIndex >= 0 && inIndex < this.games.length) {

					var game = this.games[inIndex];


					this.$.audioItem.$.gameTitle
							.setContent(game.awayAbbrev + " at "
									+ game.homeAbbrev);

					if(game.status.isFinal) {
						this.$.audioItem.$.gameStatus
						.setContent("Final");
					}
					else if(game.status.isPreview && this.isInPregameWindow(game.gameDate)){
						this.$.audioItem.$.gameStatus
						.setContent("Pregame");
					}
					else if(game.status.isLive){
						this.$.audioItem.$.gameStatus
						.setContent("Live");
					}
					else {
						this.$.audioItem.$.gameStatus
							.setContent(game.status.detailedState);
					}


					this.$.audioItem.game = game;

					// Deliberately NOT auto-selecting/auto-playing the first
					// game on load -- re-sync the feed button row only for
					// whichever game is already playing (if any), so the
					// user sees which feed is active after a 15s list
					// refresh; never picks a game/feed on the user's behalf.
					if(main.$.audioFlow.game && main.$.audioFlow.game.gamePk==game.gamePk) {
						this.audioItemClick(this.$.audioItem);
					}

					return true;
				}
				return false;
			},

			// See moreGamesHint's comment for why this exists instead of a
			// real scrollbar. Measures the list's actual current rendered
			// height rather than assuming a fixed popup layout, since the
			// available space varies with whether the login gate/date nav
			// are showing.
			updateMoreGamesHint : function() {
				// Runs asynchronously, after showLoggedInUI already hid
				// this for compact mode -- without this guard, a fetch
				// resolving later (broadcastsServiceReturn, or its 15s
				// re-poll) would call setShowing(true) right back over
				// that, since it has no other knowledge of compact mode.
				if (this.compactMode) {
					this.$.moreGamesHint.hide();
					return;
				}
				var visibleRows = this.$.list.hasNode() ? Math.floor(this.$.list.node.clientHeight / this.ROW_HEIGHT) : 0;
				this.$.moreGamesHint.setShowing(this.games.length > visibleRows);
				this.updateArrowDirection();
			},

			// Flips moreGamesHint's arrow to point toward whichever end of
			// the list still has more content. A previous attempt at this
			// replaced VirtualList with a plain enyo.Scroller to get a
			// standard scrollTop/getBoundaries() API, on the theory that
			// VirtualList's own internal scroller (enyo.VirtualScroller)
			// doesn't expose one -- that swap broke the list outright (it
			// rendered blank on-device, root cause unconfirmed without
			// device console access). Reverted back to VirtualList's proven
			// flyweight rendering; arrow direction now comes from patching
			// VirtualList's own adjustTop/adjustBottom methods instead (see
			// rendered()) -- inTop/inBottom there are row INDICES the list
			// already tracks internally for its own buffering, so this
			// needs no scroller internals at all, and if the patch ever
			// fails for some reason the list itself is unaffected -- worst
			// case the arrow just always points down.
			updateArrowDirection : function() {
				var atBottom = (this.listBottomRow != null) && (this.games.length > 0)
					&& (this.listBottomRow >= this.games.length - 1);
				this.$.moreGamesHint.setContent(atBottom ? "▲" : "▼");
			},

			broadcastsServiceReturn : function(inSender, inResponse) {
				console.log("broadcastsServiceReturn");
				try {
					this.games = BroadcastsParser.parseGamesWithBroadcasts(inResponse);

					if (this.games.length == 0) {
						this.$.buttonToolbar.hide();
					}
					else {
						this.$.buttonToolbar.show();
					}

					this.$.list.refresh();
					this.updateMoreGamesHint();
					this.trySelectPendingGame();
				}
				catch(e) {
					console.log(e);
				}

				// Only keep auto-polling while looking at today -- a past
				// date's broadcasts are archived/static, re-fetching them
				// every 15s would just waste calls for no reason.
				if (this.isViewingToday()) {
					var _self = this;
					setTimeout(function() {
						_self.fetchScoreboard();
					}, 15000);
				}
			},

			isViewingToday : function() {
				var d = this.getCurrentDate();
				return (new Date()).toDateString() == d.toDateString();
			},

			getCurrentDate : function() {
				return this.date ? new Date(this.date.getTime()) : new Date();
			},

			updateDateLabel : function() {
				var d = this.getCurrentDate();
				this.$.dateLabel.setContent(this.isViewingToday() ? "Today"
					: (Months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear()));
			},

			previousDateClick : function() {
				var d = this.getCurrentDate();
				d.setDate(d.getDate() - 1);
				this.changeDate(d);
			},
			nextDateClick : function() {
				var d = this.getCurrentDate();
				d.setDate(d.getDate() + 1);
				this.changeDate(d);
			},
			calendarButtonClick : function(sender) {
				// openAtControl positioned this relative to the "Pick Date"
				// button itself, which sits at the far right of the
				// date-nav row -- against a popup this wide, that pushed it
				// off toward the screen edge instead of over the game list
				// (screenshot confirmed live: it rendered stuck at the
				// screen's left edge). openAtCenter matches the pattern
				// already used for every other modal in this app (e.g.
				// views/Main.js's announcementsPopup/termsModal) and
				// centers in the viewport, which is where the audio popup
				// itself already sits, so this now visually centers over it.
				this.$.audioCalendar.openAtCenter();
				this.$.audioDatePicker.setValue(this.getCurrentDate());
			},
			calendarChange : function() {
				this.pendingDate = this.$.audioDatePicker.getValue();
			},
			selectDate : function() {
				this.$.audioCalendar.close();
				this.changeDate(this.pendingDate || this.getCurrentDate());
			},
			selectToday : function() {
				this.$.audioCalendar.close();
				this.changeDate(new Date());
			},

			// Switching dates shows an entirely different set of games/
			// feeds -- stop whatever's playing and forget the current
			// selection rather than leave a stale feed/game reference
			// pointing at the old date's broadcast.
			changeDate : function(newDate) {
				this.date = newDate;
				this.updateDateLabel();
				if (main.$.audioFlow.feed) {
					main.$.audioFlow.stopAudio();
				}
				main.$.audioFlow.feed = null;
				main.$.audioFlow.game = null;
				this.currentlySelectedFeedButton = null;
				this.clearFeeds();
				for (var k = 1; k <= 4; k++) {
					this.$["feed" + k].hide();
					this.$["feed" + k].feed = null;
					this.$["feed" + k].game = null;
				}
				this.fetchScoreboard();
			},

			fetchScoreboard: function() {

				var date = this.getCurrentDate();
				var yyyy = date.getFullYear(),
					mm = ("0" + (date.getMonth() + 1)).slice(-2),
					dd = ("0" + date.getDate()).slice(-2);

				this.$.broadcastsService.urlParams = {
					"date" : yyyy + "-" + mm + "-" + dd
				};
				this.$.broadcastsService.call();
			},

			actionButtonClick : function(button) {
				if (main.$.audioFlow.status == "NowPlaying") {
					main.$.audioFlow.pauseAudio();
				}
				else if (main.$.audioFlow.status == "Paused") {
					main.$.audioFlow.resumeAudio();
				}
				else if(main.$.audioFlow.feed) {
					main.$.audioFlow.startAudioFlow(main.$.audioFlow.feed,main.$.audioFlow.game);
				}
			},
			clearFeeds: function() {
				var controls = this.$.feedList.controls;
				for (var i=0, c; c=controls[i]; i++) {

					c.setDepressed(false);

				}
			},
			audioItemClick : function(audioItem) {


				this.clearFeeds();

				// set the feeds
				var game = audioItem.game;
				var feeds = game.feeds;
				var k;

				for ( var i = 0, k = 0; feeds && i < feeds.length && k < 4; i++) {
					var feed = feeds[i];

					this.setupFeedButton(this.$["feed" + (k + 1)], feed, game);

					k++;
				}

				var visibleFeedCount = k;

				while (k < 4) {
					this.$["feed" + (k + 1)].hide();

					this.$["feed" + (k + 1)].feed=null;
					this.$["feed" + (k + 1)].game=null;

					k++;
				}

				this.resizeFeedButtons(visibleFeedCount);

				// Tapping a game reveals its feed buttons only -- playback
				// starts only from an explicit tap on one of them
				// (feedClicked) or the play button once a feed is already
				// selected (actionButtonClick). Never auto-started here.

				this.$.feedList.render();

			},

			// feed1-4 default to a fixed 80px each -- enough for exactly 4
			// side by side, but for a game with fewer feeds that left the
			// unused hidden slots' width just sitting empty instead of the
			// visible buttons expanding to fill the row (screenshot
			// confirmed live: a 2-feed and a 3-feed game both left visible
			// dead space where the hidden feed3/feed4 buttons would have
			// been). Stretch each visible button to an equal share of the
			// same row every 4-feed game already fills.
			resizeFeedButtons : function(visibleCount) {
				var width = visibleCount > 0 ? (100 / visibleCount) + "%" : "80px";
				for (var i = 0; i < visibleCount; i++) {
					this.$["feed" + (i + 1)].applyStyle("width", width);
				}
			},
			setupFeedButton : function(button, feed, game) {

				button.show();

				if(main.$.audioFlow.feed && (feed.mediaId==main.$.audioFlow.feed.mediaId)) {
					button.setDepressed(true);
				}
				button
						.setCaption((feed.homeAway == "home" ? game.homeAbbrev
								: game.awayAbbrev)
								+ " "
								+ (feed.language == "en" ? "" : " - "
										+ feed.language)
								+ " - "
								+ feed.callSign);
				button.feed = feed;
				button.game = game;


			},

			feedClicked : function(inSender) {
				this.clearFeeds();

				if(inSender.feed) {
					this.currentlySelectedFeedButton= inSender;

					inSender.setDepressed(true);

					main.$.audioFlow.startAudioFlow(inSender.feed, inSender.game);

					// Gameday-only (see closeOnFeedSelect's published
					// comment) -- Scoreboard's own popup never sets this,
					// so it keeps showing the in-popup player controls
					// exactly as before.
					if (this.closeOnFeedSelect && this.hostView && this.hostView.closeAudioPopup) {
						this.hostView.closeAudioPopup();
					}
				}
			},

			// Called by views/GamedayView.js's openAudioPopup once games for
			// gamePk's date are loaded (either just-fetched, via
			// broadcastsServiceReturn, or already cached from a prior open,
			// via showLoggedInUI's else branch) -- reveals that game's feed
			// buttons directly via the same path a manual list tap uses
			// (audioItemClick), without requiring the user to find/tap it
			// in the list themselves.
			trySelectPendingGame : function() {
				if (!this.autoSelectGamePk) {
					return;
				}
				var gamePk = this.autoSelectGamePk;
				this.autoSelectGamePk = null;
				for (var i = 0; i < this.games.length; i++) {
					if (this.games[i].gamePk == gamePk) {
						this.audioItemClick({ game: this.games[i] });
						return;
					}
				}
			}
		});
