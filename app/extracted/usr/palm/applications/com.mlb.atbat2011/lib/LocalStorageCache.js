var TheCache = {};

TheCache.put=function(key,value,expires) {
	localStorage.setItem(env.currentEnv + "_" +key+"_value", value+"");
	localStorage.setItem(env.currentEnv + "_" +key+"_expires", expires+"");
	localStorage.setItem(env.currentEnv + "_" +key+"_putTime", (new Date()).getTime()+"");
};

TheCache.get=function(key) {
	var value = localStorage.getItem(env.currentEnv + "_" +key+"_value");
	var expires = localStorage.getItem(env.currentEnv + "_" +key+"_expires");
	var putTime = localStorage.getItem(env.currentEnv + "_" +key+"_putTime");
	
	if(expires=="-1" || (expires*1000 >  ((new Date()).getTime() - putTime))) {
		return {"key": key, "value": value, "expires":expires, "putTime": putTime};
	}

	return null;
};

TheCache.clear=function(key) {
	localStorage.removeItem(env.currentEnv + "_" +key+"_value");
};