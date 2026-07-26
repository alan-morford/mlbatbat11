/**
 * @author rahman_m
 */

/**
 * @namespace An XML to JSON Conversion tool. Attributes and nodes are turned into elements of an associative array. If multiple nodes
 * share the same name, an array will be created with that name to hold all those elements. If an xml node has attributes as well as
 * as a text node then the text will be saved under an element of the associative array called "_text."  
 * 
 * Also the fields "_childList" and "_nodeName" have been added to each element. "_childList" holds a list of the children elements in 
 * the order they were made available in the XML and "_nodeName" contains the name of each element.
 * 
 * @requires Util
 * @requires Log
 * @example
 *  var json = XMLJSONConverter.convert(xmlDoc);
 *  
 */
var XMLJSONConverter = (function() {
	
	/**
	 * @static
	 * @memberOf XMLJSONConverter
	 * @description Converts an xml document into valid JSON
	 * @param {Object} xmldoc The document element of an xml document
	 */
	convert=function (xmldoc) {

    var xroot = (xmldoc.nodeType == 9) ? xmldoc.documentElement : xmldoc;
    var rootNode = createJSONNode("root");
		var x = getObject(xroot);
		rootNode._childList.push(x);
		rootNode[x._nodeName] =x;
		return rootNode;
		
	};
	  //Set Attributes of an object
	function setAttributes(obj, node){
    var a = node.attributes.length - 1;
    var attName;
    do { //Order is irrelevant (speed-up)
        attName = String(node.attributes[a].name);
        obj[attName] = node.attributes[a].value;
    }
    while (a--);
	}
	
	function  createJSONNode(name) {
		return {"_childList":[], "_nodeName":name, "_text":'', "_jsonValues":{}};
	
	}
	
	function getArray(node) {
		//Log.debug("getArray2");
		var parent = node.parentNode;
		var name =node.nodeName;
		var array =[];
		

		for(var i=0; i<parent.childNodes.length; i++) {
  		var cNode = parent.childNodes[i];
  		 
  		if(cNode.nodeName==node.nodeName) {
  			//Log.debug("XMLJSONConverter_3_0", "cNode = " + cNode.nodeName);
				array.push(getObject(cNode));
  		}
		}
		return array;
	}
	
	function getObject(node) {
		var newObj, text="";
		
		if (node.attributes.length > 0) {
			newObj=createJSONNode(node.nodeName);
			setAttributes(newObj, node);
		}
		
		var childListItem=0;
		
		for(var i=0; i<node.childNodes.length; i++) {
  		var cNode = node.childNodes[i];
  		switch (cNode.nodeType) {
  			case 1:
  				if (newObj == null) {
	  				newObj = createJSONNode(node.nodeName);
	  			}
	  			
	  			newObj._childList.__defineGetter__(childListItem, (function(tmpNode) {
	  				return function() {
	  					var json = tmpNode.json;
	  					if(tmpNode.json)
	  						json=tmpNode.json;
	  					else 
	  						json = getObject(tmpNode);
	  					
	  					return json;
	  				};
	  			})(cNode));
	  			childListItem++;
	  			
	  			if(newObj.__lookupGetter__(cNode.nodeName)) {
	  				//Log.debug("XMLJSONConverter_3_0", "use array getter for : " + cNode.nodeName);
	  				newObj._jsonValues[cNode.nodeName] = "__usearray__";
	  			}
	  			else {
	  				//Log.debug("XMLJSONConverter_3_0", "creating new getter for : " + cNode.nodeName);
	  				function getFunction(tmpNode) {
		  				return function() {			  			 							  				
			  				var json = this._jsonValues[tmpNode.nodeName];			  				
			  				
			  				if(json=="__usearray__")
			  					return this._jsonValues[tmpNode.nodeName] = getArray(tmpNode);	
								
			  				else if(json!=undefined) 
			  					return json;
			  					
			  				if(tmpNode.json!=undefined)
			  					return this._jsonValues[tmpNode.nodeName] = tmpNode.json;
			  					
			  				return this._jsonValues[tmpNode.nodeName] = getObject(tmpNode);
			  					
				  		};
			  		}
	  			
			  		newObj.__defineGetter__(cNode.nodeName, getFunction(cNode));
	  			}
  				break;
  			case 3:
  				text += cNode.nodeValue;
  				break;
  			case 4:
  				text += (cNode.text) ? cNode.text : cNode.nodeValue;
  				break;
  		}
		}
		
		if(newObj==null) {
			newObj=text;
		}
		else {
			newObj._text=text;
		}
	
		node.json=newObj;
		return newObj;
	}
	
  return {
      "convert": convert
  };
	
})();










