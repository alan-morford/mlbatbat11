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
					{ kind: "Spinner", name:"spinner", style : "position:absolute; top : 10px; right:10px;"}
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
						"News" : this.$.sliding.$.News,
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
			},
			hasAcceptedTerms : function() {
				return this.acceptedTerms;
			},
			configureLeftNav : function() {

				if (this.extras && this.extras.leftnav) {
					this.$.sliding.$.leftNav.destroyComponents();

					for ( var i in this.extras.leftnav) {
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