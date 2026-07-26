/* Copyright 2009-2011 Hewlett-Packard Development Company, L.P. All rights reserved. */
enyo.kind( {
	name : "enyo.CanonView",
	kind : "VFlexBox",
	className : "enyo-bg",
	published : {
		headerContent : "",
		headerComponents : {}
	},
	events : {
		onGo : ""
	},
	components : [ 
	{kind: "Scrim", name : "scrim", onclick: "scrimClick", style : "position:absolute;top:54px;width:1024px;background-color:#333;"},
	{
		name : "header",
		kind: "Header",
		components: [
		    { name:"title", flex : 1, style:"width:100%"},
		    { kind: "Spinner", name:"spinner"} 
		]
	}, {
		kind : "Scroller",
		name: "scroller",
		style: "background-color:rgba(1,1,1,0)",
		flex : 1,
		components : [ 
		{
			name : "client",
			style: "background-color:rgba(1,1,1,0)"
			
		} ]
	}, {
		kind : "Toolbar",
		components : [ {
			kind : "GrabButton"
		}]
	} ],
	create : function() {
		this.inherited(arguments);
		this.$.title.createComponents(this.headerComponents);
	},
	scrimClick : function(){
		Views["Scoreboard"].hidePopups();
		this.$.scrim.hide();
	}

});
