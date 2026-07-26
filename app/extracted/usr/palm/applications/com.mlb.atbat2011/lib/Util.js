var Util = {};

function print(o) {
	alert(printAsStr(o));
}
function printAsStr(o) {

	var str = "";
	for ( var i in o) {
		str += i + "=" + o[i] + "\n";
	}
	return str;
}
function consolePrintAsStr(o) {

	console.log(printAsStr(o));
}

function consolePrint(o) {

	for ( var i in o) {
		console.log(i + "=" + o[i]);
	}

}


Util.array=function(objOrArray) {
        if(Util.trueTypeOf(objOrArray)=="Array") {
                return objOrArray;
        }
        else {
                if(objOrArray)
                        return [objOrArray];
                else    
                        return [];
        } 
};


/**
 * 
 * @param {Object} something The object whose type is to be determined. Return types are:
 *      string, boolean, number, object, function, String, Boolean, Number, Array, RegExp, Function
 */
Util.trueTypeOf=function(something) {
  var result = typeof something;
  try {
      switch (result) {
          case 'string':
          case 'boolean':
          case 'number':
              break;
          case 'object':
          case 'function':
              switch (something.constructor)
                      {
                  case String:
                      result = 'String';
                      break;
                  case Boolean:
                      result = 'Boolean';
                      break;
                  case Number:
                      result = 'Number';
                      break;
                  case Array:
                      result = 'Array';
                      break;
                  case RegExp:
                      result = 'RegExp';
                      break;
                  case Function:
                      result = 'Function';
                      break;
                  default:
                      var m = something.constructor.toString().match(/function\s*([^( ]+)\(/);
                      if (m)
                          result = m[1];
                      else
                          break;
              }
              break;
      }
  }
  finally {
      result = result.substr(0, 1).toUpperCase() + result.substr(1);
      return result;
  }
};

/**
 * Returns todays date in eastern standard time (using client clock)
 */
Util.getESTDate=function(){
	var date    = new Date(),
		local   = date.getTime(),
		offset  = date.getTimezoneOffset() * 60000,
		utc     = local + offset,
		estTime = utc + (3600000*offset);

	return new Date(estTime);
}




