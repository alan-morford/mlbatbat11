
enyo.kind({
	name:"mlb.CacheItem",
	published:{
		expired:false,
		value:null,
		key:null
	}
});


var TheCache = enyo.create( {
	components : [ {
		name : "dbService",
		kind : "DbService",
		dbKind : "com.mlb.atbat11.palm.cache:2",
		onFailure : "genericFailure",
		components : [
			{
				name: "delCacheDbKind",
				method: "delKind",
				onSuccess: "delDbKindSuccess",
				onFailure: "delDbKindFailure"
			},
			{
			name : "makeCacheDbKind",
			method : "putKind",
			onSuccess : "putDbKindSuccess",
			onFailure : "putDbKindFailure"
		}, {
			name : "getItem",
			method : "find",
			onResponse : "getItemResponse"

		}, {
			name : "putItem",
			method : "put",
			onResponse : "putItemResponse"
		}, {
			name : "mergeItem",
			method : "merge",
			onResponse : "mergeItemResponse"
		}

		, {
			name : "clearItem",
			method : "del",
			onResponse: "clearItemResponse"
		} ]
	}, {
		name : "list",
		kind : "DbList",
		flex : 1,
		onQuery : "listQuery",
		onSetupRow : "listSetupRow",
		components : [ {
			kind : "Item",
			layoutKind : "HFlexLayout",
			components : [ {
				name : "itemLabel",
				flex : 1
			}, {
				name : "rowLabel"
			} ]
		} ]
	} ],
	delDbKindSuccess: function() {
		this.log("DELETED DB KIND");
	},
	delDbKindFailure: function() {
		this.log();
	},
	putDbKindSuccess : function() {
		console.log("cache db created");
		for(var i in arguments) {
			consolePrintAsStr(arguments[i]);
		}
	},
	
	putDbKindFailure : function() {
		console.log("cache db failed");
		for(var i in arguments) {
			consolePrintAsStr(arguments[i]);
		}
	},
	

	put : function(key, value, expires, callback) {

		var dbKind = this.$.dbService.dbKind;
		var object = {
			_kind : dbKind,
			_id : key,
			cacheInsertTime : (new Date()).getTime(),
			cacheExpires : expires,
			cacheValue : value
		};

		this.$.mergeItem.call( {
			"callback": callback,
			"objects" : [ object ]
		});

	},
	putItemResponse : function(inSender, inResponse, inRequest) {
		//console.log("putItemResponse:response " + printAsStr(inResponse));
		//console.log("putItemResponse:sender " + printAsStr(inSender));
		//console.log("putItemResponse:request " + printAsStr(inRequest));
	},
	mergeItemResponse : function(inSender, inResponse, inRequest) {
		console.log("mergeItemResponse:response " + printAsStr(inResponse));
		//console.log("mergeItemResponse:sender " + printAsStr(inSender));
		//console.log("mergeItemResponse:request " + printAsStr(inRequest));
		inRequest.params.callback();
	},
	listQuery : function(inSender, inQuery) {
		//console.log("listQuery");
		return this.$.getItem.call( {
			query : inQuery
		});
	},

	listSetupRow : function(inSender, inRecord, inIndex) {
		//console.log("listseuptrow");
		// put the appropriate fruit data into the list rows
		this.$.itemLabel.setContent(enyo.isString(inRecord) ? inRecord
				: inRecord.cacheKey);
		this.$.rowLabel.setContent("(" + inIndex + ")");
	},

	getMultiple: function(keys, callback) {
			
		this.$.getItem.call( {
			"callback": callback, 
			"query" : {
				where : [{prop:"_id", val:keys, "op":"="}]
			}
		});
	},
	get : function(key, callback) {
		this.$.getItem.call( {
			"callback": callback, 
			"query" : {
				where : [{prop:"_id", val:key, "op":"="}]
			}
		}); 
	},

	getItemResponse : function(inSender, inResponse, inRequest) {
		////console.log("getItemResponse:" + printAsStr(inResponse));
		if(!inResponse.results || inResponse.results.length==0){
			inRequest.params.callback({});
		}
		else {
			var items={};
			for(var i=0; i<inResponse.results.length; i++) {
				var res = inResponse.results[i];
				var item = new mlb.CacheItem();
				var expired = false;
				
				if(res.cacheExpires!=-1) {
					expired=((new Date()).getTime() - res.cacheInsertTime)>(res.cacheExpires*1000);
				}
				
				if(!expired) {
					item.key=res._id;
					item.value=res.cacheValue;
					items[res._id]=item;
				}
				
			}
			inRequest.params.callback(items);

		}
	},
	
	clearItemResponse : function(inSender, inResponse, inRequest) {
		console.log("CLEAR ITEM RESPONSE");
		consolePrintAsStr(inResponse);
		inRequest.params.callback();
	},

	clear : function(key, callback) {
		this.$.clearItem.call( {
			"callback": callback, 
			"query" : {
			from:this.$.dbService.dbKind,
			where : [{prop:"_id", val:key, "op":"="}]
		}
	}); 
	}
});


