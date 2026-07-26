/* Copyright 2009-2011 Hewlett-Packard Development Company, L.P. All rights reserved. */
enyo.kind({
	name: "enyo.CanonPeekItem",
	kind: "Item",
	layoutKind: "HFlexLayout",
	align: "center",
	published: {
		caption: "",
		icon : "",
		properties: null
	},
	components: [
		{ kind: "Image", name : "icon", style : "margin : 0 7px" },
		{ kind: "CustomButton", name: "caption", flex: 1 }
	],
	create: function() {
		this.inherited(arguments);
		this.captionChanged();
		this.setIcon();
	},
	captionChanged: function() {
		this.$.caption.setContent(this.caption);
	},
	setIcon : function(){
		this.$.icon.setSrc(this.icon);
	}
});
