enyo
		.kind( {
			name : "mlb.Main",
			kind : "enyo.VFlexBox",
			published : {
				config : null,
				extras : null,
				currentAnnouncement : null,
				domain : "",
				acceptedTerms : false,
				currentMiddlePane : ""
			},

			components : [
					{
						kind : "AppMenu",
						components : [ {
							kind : "AppMenu"
						}, {
							caption : "MLB.com Mobile Site",
							onclick : "mobileSiteClick"
						}, {
							caption : "At Bat FAQ",
							onclick : "faqClick"
						}, {
							caption : "Terms and Conditions",
							onclick : "termsAndConditionsClick"
						}, {
							caption : "About MLB.com",
							onclick : "aboutClick"
						} ]
					},
					{
						name : "audioFlow",
						kind : "mlb.AudioFlow"
					},
					{
						kind : "ModalDialog",
						name : "announcementsPopup",
						className : "announcementsPopup",
						style : "width : 200px",
						showHideMode : "auto",
						dismissWithClick : false,
						components : [ {
							name : "announcementTitle",
							style : "font-weight:bold; margin-bottom: 10px;",
							content : "Announcement Title"
						}, {
							name : "announcementText",
							style : "margin-bottom:10px",
							content : "Announcement Text"
						}, {
							kind : "enyo.HFlexBox",
							components : [ {
								name : "announcementOpenButton",
								kind : "Button",
								caption : "Open",
								style : "width : 100px",
								onclick : "announcementOpenOnClick"
							}, {
								name : "announcementCloseButton",
								kind : "Button",
								caption : "Close",
								style : "width : 100px",
								onclick : "announcementCloseOnClick"
							} ]
						} ]
					},
					{
						kind : "Pane",
						name : "panes",
						flex : 1,
						transitionKind : "enyo.transitions.Fade",
						onSelectView : "viewSelected",
						published : {
							config : {}
						},
						components : [ {
							kind : "mlb.SplashScreen"
						}, {
							name : "sliding",
							kind : "mlb.Panels"
						} ]
					},
					{
						name : "getConfig",
						kind : "ConfigService",
						onSuccess : "gotConfig",
						onFailure : "failedConfig"
					},
					{
						name : "getExtras",
						kind : "ExtrasService",
						onSuccess : "gotExtras",
						onFailure : "failedExtras"
					},
					{
						kind : "ModalDialog",
						name : "systemErrorModal",
						components : [
								{
									content : "The system experienced a temporary interruption. Please try again.",
									style : "padding-left: 20px; text-align:center;"
								}, {
									layoutKind : "HFlexLayout",
									pack : "center",
									components : [ {
										kind : "Button",
										caption : "Try again",
										style : "margin-top:10px",
										onclick : "retryConfigClick"
									} ]
								} ]
					},
					{
						kind : "ModalDialog",
						name : "termsModal",
						style : "height : 500px; width : 800px;",
						components : [
								{
									name : "termsModalView",
									kind : "Scroller",
									style : "height : 440px; width : 740px;",
									components : [ {
										name : "termsDoc",
										kind : "RichText",
										value : "<p><strong>Terms and Conditions</strong></p>"
												+ Terms,
										style : "width:width : 720px;",
										disabled : true
									} ]
								},
								{
									kind : "Button",
									caption : "Accept",
									style : "width:200px; position:relative; top:39px; left : 380px;",
									onclick : "acceptTermsClick"
								},
								{
									kind : "Button",
									caption : "Cancel",
									style : "width:200px; position:relative; left : 140px;",
									onclick : "acceptTermsCancel"
								} ]
					},
					{ kind: "Spinner", name:"spinner", style : "position:absolute; top : 10px; right:10px;"},
					// Update-check popup -- same mechanism as the sibling
					// usatoday project's own Application.js/UpdatePopup.js
					// (GitHub releases API -> version compare -> Preware
					// install handoff), adapted to this app's own established
					// ModalDialog/openAtCenter() popup convention (see
					// termsModal/announcementsPopup above) rather than that
					// project's enyo.Popup + manual position:absolute
					// centering -- this app's own ModalDialog usage already
					// centers correctly with openAtCenter(), no equivalent
					// workaround needed here.
					{
						name : "updateCheck",
						kind : "WebService",
						url : "https://api.github.com/repos/alan-morford/mlbatbat11/releases/latest",
						handleAs : "json",
						onSuccess : "gotUpdateCheck",
						onFailure : "updateCheckFailed"
					},
					{
						name : "openAppForUpdate",
						kind : "PalmService",
						service : "palm://com.palm.applicationManager/",
						method : "open",
						onSuccess : "updateAppLaunched",
						onFailure : "updateAppLaunchFailed"
					},
					{
						kind : "ModalDialog",
						name : "updatePopup",
						style : "height : 420px; width : 500px;",
						dismissWithClick : false,
						components : [
							{
								content : "Update Available",
								style : "font-weight:bold; font-size:130%; margin-bottom:10px; text-align:center;"
							},
							{
								name : "updateVersionLabel",
								style : "margin-bottom:10px; text-align:center; color:#666;"
							},
							{
								name : "updateChangelogScroller",
								kind : "Scroller",
								style : "height:280px; width:460px; border:1px solid #ccc; padding:10px; margin-bottom:10px; -webkit-box-sizing:border-box; box-sizing:border-box;",
								components : [ { name : "updateChangelog", kind : "enyo.HtmlContent" } ]
							},
							{
								kind : "enyo.HFlexBox",
								pack : "center",
								components : [
									{
										kind : "Button",
										caption : "Cancel",
										style : "width:150px;",
										onclick : "updateCancelClick"
									},
									{
										kind : "Button",
										caption : "Update",
										style : "width:150px; margin-left:20px; background-color:#64A1CA; color:white;",
										onclick : "updateConfirmClick"
									}
								]
							}
						]
					}
				 ],

			ready : function() {
				// alert("MAIN READY!");
			},
			create : function() {
				this.inherited(arguments);
				
				//TheCache.$.delCacheDbKind.call(); 
				var that = this;

				// CREAT THE CACHE
				/*TheCache.$.makeCacheDbKind.call( {
					owner : enyo.fetchAppId()
				});*/
				
				this.acceptedTerms = TheCache.get("acceptedTerm") != null;

				this.domain = (env.currentEnv === "PROD") ? "http://m.mlb.com/"
						: "http://wapqa.mlb.com/";

				this.$.getConfig.urlParams = {
					"version" : enyo.fetchAppInfo()["version"]
				};
				this.$.getExtras.urlParams = {
					"version" : enyo.fetchAppInfo()["version"]
				};
				this.$.getConfig.call();

			},
			rendered : function() {
				console.log("*********MAINRENDERED*********");
				this.inherited(arguments);

				this.$.sliding.$.leftNav.render();
				Track("Main_Rendered");
			},

			gotExtras : function(inSender, inResponse, inRequest) {
				// ExtrasService (gdx.mlb.com) is permanently dead, same as
				// ConfigService -- see gotConfig() above.
				this.extras = (inResponse && inResponse.leftnav) ? inResponse : localExtras;

				doOverrides();

				this.configureLeftNav();

				if(this.hasAcceptedTerms() && this.$.panes.getViewIndex() !=1) {
					Track("AppStart");
					this.$.panes.selectViewByIndex(1);
				}

			},
			showAnnouncement : function(announcement) {
				console.log("ATTEMPT TO SHOW ANNOUNCEMENT");
		

				if (!announcement.title || !announcement.text
						|| !announcement.id) {
					return;
				}

				this.currentAnnouncement = announcement;
				if(!TheCache.get("announcement_"+announcement.id)) {
					//store it
					TheCache.put("announcement_"+announcement.id, announcement.id, -1);
					//show it

					this.$.announcementsPopup
							.openAtCenter();
					this.$.announcementTitle
							.setContent(announcement.title);
					this.$.announcementText
							.setContent(announcement.text);
					if (announcement.openButtonTitle) {
						this.$.announcementOpenButton
								.setCaption(announcement.openButtonTitle);

					} else {
						this.$.announcementOpenButton
								.setCaption("Open");
					}

					if (!announcement.href) {
						this.$.announcementOpenButton
								.hide();
					} else {
						this.$.announcementOpenButton
								.show();
					}

					if (announcement.closeButtonTitle) {
						this.$.announcementCloseButton
								.setCaption(announcement.closeButtonTitle);
					} else {
						this.$.announcementCloseButton
								.setCaption("Close");
					}

				};
				
	
			},
			retryConfigClick : function() {
				this.$.systemErrorModal.close();
				this.$.getConfig.call();
			},
			acceptTermsClick : function() {
				/*TheCache.put("acceptedTerm", true, -1, function() {
					console.log("storing acceptedTerms");
				});*/
				TheCache.put("acceptedTerm", "true", -1);
				this.$.termsModal.close();
				this.$.panes.selectViewByIndex(1);
			},
			acceptTermsCancel : function() {
				console.log("TERMS CANCELED");
				console.log(enyo.windows.getActiveWindow());
				enyo.windows.deactivateWindow(enyo.windows.getActiveWindow());
				close();
			},
			gotConfig : function(inSender, inResponse, inRequest) {
				var _self = this;
				// ConfigService (gdx.mlb.com) is permanently dead: the domain
				// resolves via CloudFront but every path returns S3
				// AccessDenied -- the feed bucket is decommissioned. Fall
				// back to the bundled data/localConfig.js instead of
				// retrying or showing a system-error modal (this used to
				// retry 10x against env.currentEnv == env.LOCAL, a
				// comparison that was always false since env.LOCAL was never
				// defined in lib/Env.js -- the fallback never actually
				// fired).
				if (!inResponse || !inResponse.firstAllowedDay) {
					inResponse = localConfig;
				}

				if (this.config == null) {
					this.config = inResponse;

					Views = {
						"Scoreboard" : this.$.sliding.$.Scoreboard,
						"Standings" : this.$.sliding.$.Standings,
						"Gameday" : this.$.sliding.$.Gameday,
						"GameSummary" : this.$.sliding.$.GameSummary,
						"News" : this.$.sliding.$.News,
						"AbsStats" : this.$.sliding.$.AbsStats,
						"Teams" : this.$.sliding.$.Teams,
						"Schedule" : this.$.sliding.$.Schedule,
						"Videos" : this.$.sliding.$.Videos,
						"Audio" : new mlb.AudioView(),
						"GenericWebView" : this.$.sliding.$.GenericWebView,
						"TermsView" : this.$.sliding.$.Terms
					};

					if (!this.hasAcceptedTerms()) {
						setTimeout(function() {
							_self.$.termsModal.openAtCenter();
						}, 500);
					}

				} else {
					this.config = inResponse;
				}

				this.$.getExtras.call();
			},
			viewSelected : function() {
				this.showViewInMiddle("Scoreboard", Views.Scoreboard);
				this.hideRightSlidingView();

				//show announements
				// show first announcement
				if (this.extras.announcements && this.extras.announcements.length > 0) {
					var announcement = this.extras.announcements.pop();
					this.showAnnouncement(announcement);
				}

				// Once per cold start (this Pane's onSelectView only fires
				// again on a later re-select, e.g. gotExtras's own
				// selectViewByIndex(1) never re-runs after the app's first
				// real screen appears) -- same "check once at launch, not on
				// every windowActivated" timing as the sibling usatoday
				// project's own Application.ready()/checkForUpdate().
				this.checkForUpdate();
			},

			// --- Update check -- see this.$.updateCheck/updatePopup/
			// openAppForUpdate above, same mechanism as the sibling
			// usatoday project's own Application.js. ---

			checkForUpdate : function() {
				this.$.updateCheck.call({});
			},
			// Silent by design -- a GitHub API hiccup, rate limit, or the
			// device being offline shouldn't show an error or interrupt app
			// launch, just mean no update popup this time.
			updateCheckFailed : function() {},

			gotUpdateCheck : function(inSender, inResponse) {
				if (!inResponse || !inResponse.tag_name) {
					return;
				}
				var remoteVersion = inResponse.tag_name.replace(/^v/i, "");
				var localVersion = enyo.fetchAppInfo()["version"];
				if (!this.isNewerVersion(remoteVersion, localVersion)) {
					return;
				}
				var ipkAsset = null;
				var assets = inResponse.assets || [];
				for (var i = 0; i < assets.length; i++) {
					if (/\.ipk$/i.test(assets[i].name || "")) {
						ipkAsset = assets[i];
						break;
					}
				}
				// No .ipk asset attached to the release (e.g. a docs-only
				// tag) -- nothing for "Update" to actually download, so
				// don't prompt.
				if (!ipkAsset) {
					return;
				}
				this.pendingUpdateUrl = ipkAsset.browser_download_url;
				this.$.updateVersionLabel.setContent("Version " + remoteVersion);
				this.$.updateChangelog.setContent(this.formatChangelog(inResponse.body || ""));
				this.$.updatePopup.openAtCenter();
			},

			// Numeric-segment compare so "1.10.0" correctly beats "1.9.0" --
			// a plain string compare would get that backwards.
			isNewerVersion : function(remote, local) {
				var r = String(remote).split("."), l = String(local).split(".");
				var len = Math.max(r.length, l.length);
				for (var i = 0; i < len; i++) {
					var rv = parseInt(r[i], 10) || 0, lv = parseInt(l[i], 10) || 0;
					if (rv > lv) { return true; }
					if (rv < lv) { return false; }
				}
				return false;
			},

			// GitHub release bodies are GitHub-flavored markdown; this app
			// has no markdown renderer, but enyo.HtmlContent already renders
			// raw HTML elsewhere (e.g. the box score/challenge-detail HTML
			// this app builds directly), so a small, safe subset covers the
			// plain "## heading" / "- bullet" / "**bold**" style release
			// notes actually written for this project.
			formatChangelog : function(markdown) {
				var html = String(markdown)
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;");
				html = html
					.replace(/\r\n/g, "\n")
					.replace(/^##+\s*(.*)$/gm, "<strong>$1</strong>")
					.replace(/^-\s+(.*)$/gm, "&bull;&nbsp;$1")
					.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
					.replace(/\n/g, "<br>");
				return html;
			},

			updateCancelClick : function() {
				this.$.updatePopup.close();
			},

			updateConfirmClick : function() {
				this.$.updatePopup.close();
				if (!this.pendingUpdateUrl) {
					return;
				}
				// Hand the actual download+install off to Preware rather
				// than the system browser -- same contract the sibling
				// usatoday project's own downloadUpdate() already uses
				// (applicationManager "open" with type:"install"/file:<url>
				// tells Preware to fetch and install that .ipk directly).
				this.$.openAppForUpdate.call({
					id : "org.webosinternals.preware",
					params : { type : "install", file : this.pendingUpdateUrl }
				});
				// Preware is about to overwrite this app's own .ipk on disk,
				// so it can't safely keep running -- give webOS a couple
				// seconds to bring Preware to the foreground, then close
				// this app's own card.
				setTimeout(function() {
					window.close();
				}, 2000);
			},
			updateAppLaunched : function() {},
			updateAppLaunchFailed : function(inSender, inResponse) {
				console.log("openAppForUpdate failed: " + JSON.stringify(inResponse).substring(0, 200));
			},

			hasAcceptedTerms : function() {
				return this.acceptedTerms;
			},
			configureLeftNav : function() {

				if (this.extras && this.extras.leftnav) {
					this.$.sliding.$.leftNav.destroyComponents();

					// Plain indexed loop, NOT for...in -- confirmed live
					// (2026-08-08) that for...in over this ARRAY was
					// picking up two extra "entries" beyond the real ones:
					// lib/external/Readability.js polyfills
					// Array.prototype.includes/find as plain enumerable
					// assignments (`Array.prototype.includes = function
					// ...`, no Object.defineProperty with
					// enumerable:false) on this old WebKit, which has
					// neither natively -- for...in walks the prototype
					// chain too, so `i` ended up "includes"/"find" on top
					// of the real numeric indices, and
					// this.extras.leftnav[i] for those was the polyfill
					// FUNCTION itself, not undefined -- item.title being
					// undefined on that still created a real (blank-
					// captioned) CanonPeekItem. This is exactly the two
					// blank left-nav entries the user reported seeing
					// under Videos.
					for (var i = 0; i < this.extras.leftnav.length; i++) {
						var item = this.extras.leftnav[i];

						var theComponent = this.$.sliding.$.leftNav
								.createComponent( {
									kind : "CanonPeekItem",
									caption : item.title,
									icon : item.icon,
									properties : item,
									onclick : "itemClicked"
								});

						if (this.$.sliding.$.leftNav.lastItemClicked) {
							if (this.$.sliding.$.leftNav.lastItemClicked.properties.title == item.title) {
								this.$.sliding.$.leftNav.lastItemClicked = theComponent;
								theComponent.addClass("clicked");
							}
						} else {
							if (item.clicked = "true") {
								theComponent.addClass("clicked");
								this.$.sliding.$.leftNav.lastItemClicked = theComponent;
							}
						}

					}

					this.$.sliding.$.leftNav.render();
				}
			},

			failedConfig : function(inSender, inResponse, inRequest) {
				this.gotConfig(inSender, null, inRequest);
			},

			failedExtras : function(inSender, inResponse, inRequest) {
				this.gotExtras(inSender, null, inRequest);
			},

			announcementOpenOnClick : function() {
				console.log("ATTEMPTING TO OPEN A NEW WINDOW");
				open(this.currentAnnouncement.href);
				this.$.announcementsPopup.close();
			},
			announcementCloseOnClick : function() {

				this.$.announcementsPopup.close();

				if (this.extras.announcements.length > 0) {
					var announcement = this.extras.announcements.pop();
					this.showAnnouncement(announcement);
				}
			},

			showViewInMiddle : function(viewName, component) {
				this.currentMiddlePane = viewName;
				this.$.sliding.$.panes.selectViewByName(viewName);

			},

			showViewInRight : function(title, component) {

				this.$.sliding.$.rightSlidingView.show();

				this.$.sliding.$.rightCanonView.$.title.setContent(title);

				component.renderInto(enyo
						.byId(this.$.sliding.$.rightCanonView.$.scroller.id));

			},

			showMiddleSpinner : function() {
				// this.$.spinner.setStyle("visibility : visible");
				this.$.spinner.show();
			},

			hideMiddleSpinner : function() {
				// this.$.spinner.setStyle("visibility : hidden");
				this.$.spinner.hide();
			},

			// Shows/hides views/Panels2.js's leftNavBlocker -- see
			// that file's own comment on why this needs a dedicated
			// blocker (a middle-pane view's own overlay can't reach
			// the left nav at all, it lives entirely outside that
			// view's box). Called from views/VideosView.js's
			// showPlaybackOverlay/hidePlaybackOverlay/cancelPlayback,
			// same open/close pairing as that view's own overlay.
			setLeftNavBlocked : function(blocked) {
				this.$.sliding.$.leftNavBlocker.setShowing(!!blocked);
			},

			hideRightSlidingView : function() {
				console.log("TRYING TO HIDE THE RIGHT SLIDING VIEW");
				// print(this.$.sliding.$.slidingPane);
				this.$.sliding.$.rightSlidingView.hide();
			},
			mobileSiteClick : function() {
				open(this.domain);
				// Views["Scoreboard"].hidePopups();
			},
			faqClick : function() {
				//this.$.sliding.$.GenericWebView.$.genericWebViewHeader.$.title.setContent("At Bat FAQ");
				this.$.sliding.$.GenericWebView.title="At Bat FAQ";
				this.$.sliding.$.GenericWebView.$.webview.setUrl(this.domain + "atbat/palm/faq?y=2011&mlbtv=true&ref=palm-atbat11");
				this.showViewInMiddle("GenericWebView");
				this.$.sliding.$.leftNav.lastItemClicked.removeClass("clicked");
			},
			aboutClick : function() {
				this.$.sliding.$.GenericWebView.title="About MLB.com";
				this.$.sliding.$.GenericWebView.$.webview.setUrl(this.domain + "atbat/palm/about_mlb?ref=palm-atbat11");
				this.showViewInMiddle("GenericWebView");
				this.$.sliding.$.leftNav.lastItemClicked.removeClass("clicked");
			},
			termsAndConditionsClick : function() {
				this.showViewInMiddle("Terms");
				var that = this;
				setTimeout(function() {
					that.$.sliding.$.Terms.$.scroller.scrollTo(0, 0);
				}, 400);
				this.$.sliding.$.leftNav.lastItemClicked.removeClass("clicked");
			},
			launchVideo : function(url){
				Track("VideoPlay");
				this.$.audioFlow.pauseAudio();
				open(url);
			}
		});
var Views = null;