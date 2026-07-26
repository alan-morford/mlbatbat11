var Track = function(page, guid, errCode){
	var deviceInfo = enyo.fetchDeviceInfo() || { serialNumber : "127.0.0.1", modelName : "browser", platformVersion : "0" },
		trackingParams = [
			"?ch=" + enyo.fetchAppId(), // bundle id (app id)
			"vid=" + deviceInfo.serialNumber, //device id for visitor id
			"c1=" + deviceInfo.serialNumber, //again for unique device id
			"c6=" + deviceInfo.modelName,
			"c7=WebOS",
			"c8=" + deviceInfo.platformVersion,
			"c11=na", // can't get network
			"c12=" + enyo.fetchAppInfo().version
		],
		url = (env.currentEnv==="PROD")
				? "http://mlbabpalm.112.2O7.net/b/ss/mlbabpalm/1/G.5--NS/" 
				: "http://mlbabpalmdev.112.2O7.net/b/ss/mlbabpalmdev/1/G.5--NS/",
		timeStamp = (new Date()).getTime();

	if(page){ trackingParams.push("pageName=" + page); }
	if(guid){ trackingParams.push("c5=" + guid); }
	if(errCode){ trackingParams.push("c29=" + errCode); }

	url += timeStamp + trackingParams.join("&");

	void(enyo.xhrGet({
		url  : url,
		laod : function(){
			console.log("Tracking Successful: " + url);
		}
	}));
};