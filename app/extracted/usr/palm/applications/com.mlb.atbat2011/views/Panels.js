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
											style : "margin : 0 20px"
										} ]
									},
									{

										flex : 1,
										name : "leftNav",
										className : "leftNav",
										components : [],
										"itemClicked" : function(item) {
											
											item.addClass("clicked");
											if(this.lastItemClicked) {
												 if(this.lastItemClicked.properties.title == item.properties.title) {
													 return; // do nothing
												 }
												 else {
													 this.lastItemClicked.removeClass("clicked");
												 }
											}
											this.lastItemClicked = item;
											

											var showit = function() {
												
												var view = Views[item.properties.view];
												view.params = item.properties.params;
												if (item.properties.view == "GenericWebView") {
													view.title = item.properties.title;
												}
												Views["Scoreboard"].hidePopups();
												sliding.$.middleCanonView.$.scrim.hide();
												Views["Scoreboard"].scrollTo(0,0);
												main
													.showViewInMiddle(
														item.properties.title,
														Views[item.properties.view]
													);

											};
											
											if (main.$.sliding.$.rightSlidingView.showing) {
												main.hideRightSlidingView();
												setTimeout(showit, 750);
											} else {
												showit();
											}

											Track(item.properties.view);

										}

									}, {
										kind : "Toolbar"
									} ]
						}, {
							name : "middleSlidingView",
							flex : 1,
							//peekWidth : 200,

							onResize : "slidingResize",
							components : [ {
								name : "middleCanonView",
								kind : "CanonView",
								headerContent : "",
								flex : 1,
								components : []
							} ]
						}, {
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
							//onGo : "gotoLeft"
							//style : "background-color: rgba(1,1,1,0); width: 900px"
							} ]
						}

				]
			} ],
			/*
			 * gotoLeft : function() {
			 * this.$.slidingPane.selectView(this.$.left); },
			 * 
			 * gotoRight : function() {
			 * this.$.slidingPane.selectView(this.$.right); },
			 */
			gotoMiddle : function() {
				// this.$.slidingPane.selectView(this.$.middleSlidingView);
		},
		itemClicked : function() {
			console.log("ITEM CLICKED!");
		},

		slidingSelected : function(inSender, inSliding, inLastSliding) {
			//print(this.$.rightSlidingView);
			//print(this.$.slidingPane);
			console.log("SLIDING SELECTED!! lastslding:" + inLastSliding);
			if (inSliding.index == 0) {
				console.log("HIDE RIGHT SLIDING VIEW");
				//	main.hideRightSlidingView();
			}

			this.log(inSliding.id, (inLastSliding || 0).id);
		},
		slidingResize : function(inSender) {
			console.log("SLIDING RESIZE!!");
			this.log(inSender.id);
		},
		backHandler : function(inSender, e) {
			console.log("BACK!!");
			//this.$.slidingPane.back(e);
		},
		resizeHandler : function() {
			console.log("RESIZE HANDLER!!");
			//this.$.slidingPane.resize();
		}
		});