var _globalMemCache={
		
};
enyo.kind({
	name: "MLBWebService",
	kind: "WebService",
	published: {
		"cacheExpires":99999999, //never
		"urlParams":{},
		"urlTemplate":"",
		//OVERRIDES
		"envQA": {}
	
	},
	create: function() {
		this.inherited(arguments);
	},
	responseSuccess:function (inRequest) {
		
		inRequest.putTime = (new Date()).getTime();
		_globalMemCache[this.getUrl()]=inRequest;
		this.dispatchResponse(inRequest.onSuccess, inRequest);
	},
	getUrl: function() {
		
		//provided a url
		if(!this.urlTemplate && this.url) {
			return this.url;
		}
		
		//no url provided, use template
		var template = this.urlTemplate;
		
		
		var envOverrides = this["env"+env.currentEnv];
		
		if(envOverrides && envOverrides.urlTemplate) {
			template = envOverrides.urlTemplate;
		}
		var encoded={};
		for(var i in this.urlParams) {
			encoded[i] = encodeURIComponent(this.urlParams[i]);
		}
		var url = enyo.macroize(template, encoded);
		this.url = url;
		return this.url;
	},
	call:function (inParams, inProps) {
		
		var obj = _globalMemCache[this.getUrl()];
		
		if(obj && obj.putTime >= ((new Date()).getTime() - this.cacheExpires*1000)) {
			
			this.dispatchResponse(obj.onSuccess, obj);
			return obj;
		}
	

		var props = inProps || {};
		props.params = props.params || inParams || this.params || {};
		var m = this.findMethodHandler(props.method || this.method) || "request";
		
		
		return this[m](props);
	}
	

});