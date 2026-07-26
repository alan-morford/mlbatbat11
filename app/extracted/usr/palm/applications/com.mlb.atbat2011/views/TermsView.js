enyo.kind( {
	name : "mlb.TermsViewHeader",
	kind : "Header",
	flex: 1,
	components: [
		{
			style: "padding-left:20px; padding-top: 15px; width: 100%; height: 100%; color: white; font-weight: bold; font-size:130%; valign:middle",
			name: "title",
			content : "Terms and Conditions"
		}
	]
});

enyo.kind({
	name : "mlb.TermsView",
	kind : "enyo.VFlexBox",
	style : "background-color : white",
	flex: 1,
	components : [
	{
		kind : "enyo.VFlexBox",
		flex:1,
		components : [ {
			flex:0,
			name : "TermsViewHeader",
			kind : "mlb.TermsViewHeader"
			
		},
		{
			kind : "Scroller",
			name : "scroller",
			flex: 1,
			components : [{
				name : "termsDoc",
				kind : "RichText",
				value : Terms,
				style: "height: 100%",
				disabled : true
			}]
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

	}
	]
	
});

