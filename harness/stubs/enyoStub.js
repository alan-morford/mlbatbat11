// Minimal no-op shim of the Enyo 1.0 surface, just enough to eval real app
// source files under Node without a browser. Most lib/*.js files in this app
// are plain object literals (not enyo.kind), so this rarely needs to do more
// than not throw.
function makeEnyo() {
	var registry = {};

	function registerName(name, ctor) {
		if (!name) return;
		var parts = name.split(".");
		var target = registry;
		for (var i = 0; i < parts.length - 1; i++) {
			target[parts[i]] = target[parts[i]] || {};
			target = target[parts[i]];
		}
		target[parts[parts.length - 1]] = ctor;
	}

	var enyo = {
		kind: function (def) {
			function Ctor() {}
			Ctor.prototype = def;
			registerName(def.name, Ctor);
			return Ctor;
		},
		mixin: function (target) {
			for (var i = 1; i < arguments.length; i++) {
				var src = arguments[i];
				for (var k in src) target[k] = src[k];
			}
			return target;
		},
		log: function () { console.log.apply(console, arguments); },
		warn: function () { console.warn.apply(console, arguments); },
		error: function () { console.error.apply(console, arguments); },
		macroize: function (template, params) {
			return template.replace(/\{\$([^}]+)\}/g, function (m, key) {
				return params && params[key] !== undefined ? params[key] : m;
			});
		},
		_registry: registry
	};

	return enyo;
}

module.exports = { makeEnyo: makeEnyo };
