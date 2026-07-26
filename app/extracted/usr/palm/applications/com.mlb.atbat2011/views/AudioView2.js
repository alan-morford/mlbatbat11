var platform = "IPHONE";
var audioSKU = "IPHONEATBAT2011";

enyo.kind( {
	name : "mlb.AudioFeed",
	published : {
		feed : null,
		game : null
	}

});

enyo
		.kind( {
			name : "mlb.AudioItem",
			kind : enyo.HFlexBox,
			published : {
				audioData : null,
				flowParams: {},
				currentlySelectedFeed:null,
				lastFlowItem:null,
				lastFlowResponse:null,
				flowSteps:{}
			},
			components : [
					{
						name : "gameTitle"
					},
					{
						kind : "mlb.AudioFeed",
						name : "feed1",
						kind : "Button",
						content : "feed1",
						onclick : "feedClicked"
					},
					{
						kind : "mlb.AudioFeed",
						name : "feed2",
						kind : "Button",
						content : "feed2",
						onclick : "feedClicked"
					},
					{
						kind : "mlb.AudioFeed",
						name : "feed3",
						kind : "Button",
						content : "feed3",
						onclick : "feedClicked"
					},
					{
						kind : "mlb.AudioFeed",
						name : "feed4",
						kind : "Button",
						content : "feed4",
						onclick : "feedClicked"
					},
					{
						kind : "Sound",
						name : "audioPlayer"
					},
					{
						name : "loginService",
						kind : "WebService",
						url : "https://secure.mlb.com/pubajaxws/services/IdentityPointService",
						method : "POST",
						handleAs : "xml",
						contentType : "text/xml",
						headers : {
							"Content-type" : "text/xml; charset=utf-8",
							"SOAPAction" : "http://services.bamnetworks.com/registration/identityPoint/identify"
						},
						onSuccess : "loginReturn"
					},

					{
						name : "registerService",
						kind : "WebService",
						url : "https://secure.mlb.com/pubajaxws/services/IdentityPointService",
						method : "POST",
						handleAs : "xml",
						contentType : "text/xml",
						headers : {
							"Content-type" : "text/xml; charset=utf-8",
							"SOAPAction" : "http://services.bamnetworks.com/registration/identityPoint/create"
						},
						onSuccess : "registerReturn"
					},

					{
						name : "fulfillmentService",
						kind : "WebService",
						url : "https://secure.mlb.com/pubajaxws/bamrest/fulfillment/op-fulfill/v-1.0",
						method : "POST",
						handleAs : "xml",
						onSuccess : "fulfillmentReturn"
					},

					{
						name : "mediaService",
						kind : "WebService",
						method : "GET",
						handleAs : "xml",
						onSuccess : "mediaServiceReturn"
					},

					{
						name : "propertiesService",
						kind : "PalmService",
						service : "palm://com.palm.preferences/systemProperties/",
						method : "Get",
						onSuccess : "gotDeviceId",
						onFailure : "failureHandler"
					}

			],
			rendered : function() {

				this.inherited(arguments);
				this.childrenRendered();
			
				this.setupFlow();
			},

			feedClicked : function(inSender) {
				this.startAudioFlow(inSender);
			},
			setupFlow: function() {
								
				var _self=this;
				this.flowSteps.getDeviceId=function() {
					//get the device id
					console.log("getDeviceId");
					_self.$.propertiesService.call( {
						"callback": function(inResponse) {						
							_self.flowParams.deviceId = "palm_"+inResponse["com.palm.properties.nduid"];
							_self.continueFlow({"statusCode":"success"});
						},
						"key" : "com.palm.properties.nduid"
					});
				};
				
				this.flowSteps.getAuthorizationParams= function() {
					console.log("getAuthorizationParams");
					TheCache.getMultiple(["sessionKey","identityPointId","fingerPrint"], function(results) {
						console.log(printAsStr(results.sessionKey));
						_self.flowParams.sessionKey = results.sessionKey ? results.sessionKey.value : "";
						_self.flowParams.identityPointId = results.identityPointId ? results.identityPointId.value : "";
						_self.flowParams.fingerPrint = results.fingerPrint ? results.fingerPrint.value : "";
						
						_self.continueFlow({response:"success"});
					});
				};
				
				this.flowSteps.login=function() {
					console.log("login");
					_self.$.loginService
					.call("<?xml version='1.0' encoding='UTF-8'?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://services.bamnetworks.com/registration/types/1.4\"><soapenv:Header/><soapenv:Body><ns:identityPoint_identify_request><ns:identification type=\"iPhone\"><ns:profileProperty><ns:name>iPhoneDeviceId</ns:name><ns:value>"
							+ _self.flowParams.deviceId
							+ "</ns:value></ns:profileProperty></ns:identification></ns:identityPoint_identify_request></soapenv:Body></soapenv:Envelope>");

				};
				
				this.flowSteps.register=function() {
					console.log("register");
					_self.$.registerService
					.call("<?xml version='1.0' encoding='UTF-8'?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://services.bamnetworks.com/registration/types/1.4\"><soapenv:Header/><soapenv:Body><ns:identityPoint_create_request><ns:identification type=\"iPhone\"><ns:profileProperty><ns:name>iPhoneDeviceId</ns:name><ns:value>"
							+ _self.flowParams.deviceId
							+ "</ns:value></ns:profileProperty></ns:identification></ns:identityPoint_create_request></soapenv:Body></soapenv:Envelope>");

				};
				
				this.flowSteps.fetchMedia=function() {
					console.log("fetchMedia");
					_self.$.mediaService
							.setUrl(enyo
									.macroize(
											"https://mlb-ws.mlb.com/pubajaxws/bamrest/MediaService2_0/op-findUserVerifiedEvent/v-2.3?platform={$platform}&subject=LIVE_EVENT_COVERAGE&eventId={$calendarEventId}&contentId={$contentId}&playbackScenario={$playbackScenario}&deviceId={$deviceId}&sessionKey={$sessionKey}&fingerprint={$fingerprint}&identityPointId={$identityPointId}",
											{
												"platform" : platform,
												"calendarEventId" : _self.currentlySelectedFeed.feed.calendar_event_id,
												"contentId" : _self.currentlySelectedFeed.feed.content_id,
												"playbackScenario" : "AUDIO_SHOUTCAST_32K",
												"deviceId" : _self.flowParams.deviceId,
												"sessionKey" : _self.flowParams.sessionKey ? _self.flowParams.sessionKey : "",
												"fingerprint" : _self.flowParams.fingerPrint,
												"identityPointId" : _self.flowParams.identityPointId
											}));
					// console.log("this.$.mediaService.url="+this.$.mediaService.url);
					_self.$.mediaService.call();

				};
				
				this.flowSteps.fulfill=function() {
					console.log("attempting fulfillment");
					var fulfillmentRequestBody = enyo
							.macroize(
									"identityPointId={$identityPointId}&fingerprint={$fingerPrint}&sku={$sku}&type=MOBILE&appAccountName=mlb",
									{
										"identityPointId" : _self.flowParams.identityPointId,
										"fingerPrint" : _self.flowParams.fingerPrint,
										"sku" : audioSKU
									});
					_self.$.fulfillmentService.call(fulfillmentRequestBody);
				};
				
				this.flowSteps.playAudio=function() {
					console.log("playAudio");
					_self.$.audioPlayer.setSrc(_self.flowParams.mediaUrl);
					_self.$.audioPlayer.play();
				};
				
				
			},
			
			
			continueFlow: function(response) {
	
				this.lastFlowResponse=response;
				this.businessLogic();
			},
			flowTo: function(flowItemName) {
	
				this.lastFlowItem = flowItemName;
				this.lastFlowResponse=null;
				this.flowSteps[flowItemName]();
			},
			businessLogic: function() {
				console.log("businessLogic, lastFlowItem=" + this.lastFlowItem + " lastFlowResponse=" + this.lastFlowResponse + " flowParams=" + printAsStr(this.flowParams));

				//GET DEVICEID
				if(this.flowItem==null) {
					this.flowTo("getDeviceId");
					return;
				}
				
				if(this.flowItem=="getDeviceId") {
					if(this.flowItemResponse.status=="success") {
						this.flowParams.deviceId = this.flowItemResponse.deviceId;
						this.flowTo("getAuthorizationParams");
					}
					else {
						//failure to get device id, prompt with Unexpected error message
					}
					return;
				}
				
				
				//GET FINGERPRINT, IDENTITYPOINT, AND SESSION KEY FROM LOCAL DATABASE
				if(this.flowItem=="getAuthorizationParams") {
					if(this.flowItemResponse.status=="success") {
						this.flowParams.sessionKey = this.flowItemResponse.sessionKey;
						if(!this.flowItemResponse.fingerPrint || !this.flowItemResponse.identityPointId) {
							this.flowTo("login");
						}
					}
					else {
						this.flowTo("fetchMedia");
					}
					return;
				} 
				
				
				if(this.flowItem=="login") {
					if(this.flowItemResponse.status=="success") {
						this.flowParams.identityPointId=this.flowItemResponse.identityPointId;
						this.flowParams.fingerPrint = this.flowItemResponse.fingerPrint;
						this.flowTo("fetchMedia");
					}
					else if(this.flowItemResponse.status=="NoSuchUser") {
						this.flowTo("register");
					}
					else if(this.flowItemResponse.status=="UnexpectedError") {
						//Unexpected Error
							
					}
					return;
				}
				
				if(this.flowItem=="register") {
					if(this.flowItemResponse.status=="success") {
						this.flowParams.identityPointId=this.flowItemResponse.identityPointId;
						this.flowParams.fingerPrint = this.flowItemResponse.fingerPrint;
						this.flowTo("fulfill");
					}
					else if(this.flowItemResponse.status=="UnexpectedError") {
						//Unexpected Error
					}
					return;
				}
				
				if(this.flowItem == "fetchMedia") {
					if(this.flowItemResponse.status=="success") {
						this.flowParams.mediaUrl = this.flowItemResponse.mediaUrl;
						this.flowTo("playAudio");
					}
					else if(this.flowItemResponse.status=="NotAuthorized") {
						this.flowTo("fulfill");
					}
					else if(this.flowItemResponse.status=="LoginRequired") {
						this.flowTo("login");
					}
					else if(this.flowItemResponse.status=="TooManySignOns") {
						//Too many sign ons
					}
					else if(this.flowItemResponse.status=="UnexpectedError") {
						//Unexpected Error
					}
					return;
					                                                         
				}
				
				if(this.flowItem == "fulfill")  {
					if(this.flowItemResponse.status=="success") {
						this.flowTo("fetchMedia");
					}
					else {
						//Unexpected Error
					}
				}

				
			},
			
	
			gotDeviceId : function(inSender, inResponse, inRequest) {
				console.log("gotDeviceId");
				inRequest.params.callback(inResponse);
			},

			startAudioFlow : function(feed) {
				console.log("startAudioFlow");
				this.currentlySelectedFeed = feed;
				
				this.lastFlowItem=null;
				this.lastFlowResponse=null;
				this.flowParams = {};
			
				this.businessLogic();
			},

			loginReturn : function(inSender, inResponse, inRequest) {

				console.log("loginReturn");
				var responseJSON = XMLJSONConverter.convert(inResponse);

				var statusCode = responseJSON["soapenv:Envelope"]["soapenv:Body"].identityPoint_identify_response.status.code;

				
				if (statusCode == 1) { // SUCCESS

					this.flowParams.identityPointId = responseJSON["soapenv:Envelope"]["soapenv:Body"].identityPoint_identify_response.identification.id;
					this.flowParams.fingerPrint = responseJSON["soapenv:Envelope"]["soapenv:Body"].identityPoint_identify_response.identification.fingerprint;
					TheCache.put("identityPointId", this.flowParams.identityPointId, 6*60*60, function() {
						console.log("storing identityPointId");
					});
					TheCache.put("fingerPrint", this.flowParams.fingerPrint, 6*60*60, function() {
						console.log("storing fingerPrint");
					});
				}
				
				this.continueFlow({"statusCode":statusCode});
				
			},

			registerReturn : function(inSender, inResponse, inRequest) {
				console.log("registerReturn");
				var responseJSON = XMLJSONConverter.convert(inResponse);

				var statusCode = responseJSON["soapenv:Envelope"]["soapenv:Body"].identityPoint_create_response.status.code;
				if (statusCode == 1) {
					this.flowParams.identityPointId = responseJSON["soapenv:Envelope"]["soapenv:Body"].identityPoint_create_response.identification.id;
					this.flowParams.fingerPrint = responseJSON["soapenv:Envelope"]["soapenv:Body"].identityPoint_create_response.identification.fingerprint;
					TheCache.put("identityPointId", this.flowParams.identityPointId, 6*60*60*1000, function() {
						console.log("storing identityPointId");
					});
					TheCache.put("fingerPrint", this.flowParams.fingerPrint, 6*60*60*1000, function() {
						console.log("storing fingerPrint");
					});
				}
				
				this.continueFlow({"statusCode":statusCode});

			},

			fulfillmentReturn : function(inSender, inResponse, inRequest) {
				console.log("fulfillmentReturn");
				var responseJSON = XMLJSONConverter.convert(inResponse);

				/*				if (responseJSON["orderless-fulfillment-response"]["status-code"] == 0) { // success
					this.fetchMedia();
				}*/
				
				var statusCode=responseJSON["orderless-fulfillment-response"]["status-code"];
				
				this.continueFlow({"statusCode": statusCode});
			},
	
			mediaServiceReturn : function(inSender, inResponse, inRequest) {
				console.log("mediaServiceReturn");
				console.log(printAsStr(inResponse));
				var responseJSON = XMLJSONConverter.convert(inResponse);
				this.flowParams.sessionKey = responseJSON["user-verified-media-response"]["session-key"];
				
				if(responseJSON["user-verified-media-response"]["session-key"]) {
					TheCache.put("sessionKey", this.flowParams.sessionKey, 100*24*60*60, function() {
						console.log("storing sessionKey");
					});
				}
				
				var statusCode = responseJSON["user-verified-media-response"]["status-code"];
				var statusMessage = responseJSON["user-verified-media-response"]["status-message"];
				
				var response={};
				response.statusCode=statusCode;
				response.statusMessage = statusMessage;
				
				if(responseJSON["user-verified-media-response"]["user-verified-event"] && responseJSON["user-verified-media-response"]["user-verified-event"]["user-verified-content"]) {
					var mediaItem = responseJSON["user-verified-media-response"]["user-verified-event"]["user-verified-content"]["user-verified-media-item"];
					if (mediaItem["auth-status"] && ("notAuthorizedStatus" in mediaItem["auth-status"] || "loginRequiredStatus" in mediaItem["auth-status"])) {
						console.log("loginRequiredStatus");
						response.authorized=false;
					} 
					else {
						response.authorized=true;
						this.flowParams.mediaUrl = mediaItem.url;
					}
				}

				
				this.continueFlow(response);
				

			}

		});

enyo
		.kind( {
			name : "mlb.AudioView",
			kind : enyo.VFlexBox,
			flex : 1,
			published : {
				date : null
			},
			components : [
			              {
			            	  name: "dblist",
			            	  content:"dblist"
			              },
					{
						kind : "Popup",
						name : "popup",
						components : [ {
							name : "popupbody",
							content : "Hello World!"
						} ]
					},
					{
						kind : "VirtualList",
						flex : 1,
						name : "list",
						onSetupRow : "listSetupRow",
						components : [ {
							kind : "mlb.AudioItem"
						} ]
					},

					{
						name : "scoreboardService",
						kind : "WebService",
						//url : "http://gdx.mlb.com/components/game/mlb/year_2011/month_06/day_27/scoreboard_iphone.xml",
						//url : "/Users/morizzle/Documents/workspace/AtBat/sampledata/scoreboard_android.xml",
						method : "GET",
						handleAs : "xml",
						onSuccess : "scoreboardServiceReturn"
					} ],
			create : function() {
				console.log("Create AudioView");
				this.games = [];
				this.inherited(arguments);

			},
			rendered : function() {
				this.node = enyo.byId(this.id);
				this.inherited(arguments);
				this.childrenRendered();

				var date  = new Date();
				var dateFormat = new enyo.g11n.DateFmt("yyyyMMdd");
				var dateStr = dateFormat.format(date);
			
				this.$.scoreboardService.setUrl(enyo.macroize("http://gdx.mlb.com/components/game/mlb/year_{$yyyy}/month_{$mm}/day_{$dd}/scoreboard_iphone.xml",{"yyyy": dateStr.substring(0,4), "mm": dateStr.substring(4,6), "dd": dateStr.substring(6)}));
				this.$.scoreboardService.call();
				
				
			},

			listSetupRow : function(inSender, inIndex) {

				if (inIndex >= 0 && inIndex < this.games.length) {
					var game = this.games[inIndex];
					var feeds = Util.array(game.audio.afeed);
					this.$.audioItem.$.gameTitle
							.setContent(game.away_name_abbrev + " at "
									+ game.home_name_abbrev);
					for ( var i = 0, k = 0; feeds && i < feeds.length; i++) {
						var feed = feeds[i];
						if (feed.playback_scenario == "AUDIO_SHOUTCAST_32K"
								&& feed.media_state == "MEDIA_ON") {

							if (k == 0) {
								this.$.audioItem.$.feed1
										.setContent(feed.station);
								this.$.audioItem.$.feed1.feed = feed;
								this.$.audioItem.$.feed1.game = game;

							} else if (k == 1) {
								this.$.audioItem.$.feed2
										.setContent(feed.station);
								this.$.audioItem.$.feed2.feed = feed;
								this.$.audioItem.$.feed2.game = game;

							} else if (k == 2) {
								this.$.audioItem.$.feed3
										.setContent(feed.station);
								this.$.audioItem.$.feed3.feed = feed;
								this.$.audioItem.$.feed3.game = game;

							} else if (k == 3) {
								this.$.audioItem.$.feed4
										.setContent(feed.station);
								this.$.audioItem.$.feed4.feed = feed;
								this.$.audioItem.$.feed4.game = game;

							}
							k++;
						}
					}

					return true;
				}
				return false;
			},

			scoreboardServiceReturn : function(inSender, inResponse, inRequest) {
				console.log("scoreboardServiceReturn");
				this.games = this.getGamesWithAudio(XMLJSONConverter
						.convert(inResponse).games.game);
				
				if(this.games.length==0) {
					this.$.popupbody.setContent("No Audio Currently Available");
					this.$.popup.open();
				}
				this.$.list.refresh();
			},

			getGamesWithAudio : function(games) {

				var game;
				var gamesWithAudio = [];

				for ( var g = 0; g < games.length; g++) {
					game = games[g];
					if (game.audio) {
						var feeds = Util.array(game.audio.afeed);

						for ( var i = 0, k = 0; feeds && i < feeds.length; i++) {
							var feed = feeds[i];
							if (feed.playback_scenario == "AUDIO_SHOUTCAST_32K"
									&& feed.media_state == "MEDIA_ON") {
								gamesWithAudio.push(game);
								break;
							}
						}
					}
				}
				
			
				return gamesWithAudio;
			}
		});
