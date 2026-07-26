// Minimal document/window/localStorage/XMLHttpRequest shims. Real network
// calls in harness tests go through Node's global fetch directly, not
// through this XHR shim -- it exists only so app source files that reference
// these globals at load time (rather than call time) don't throw.
function makeLocalStorage() {
	var store = {};
	return {
		getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
		setItem: function (k, v) { store[k] = String(v); },
		removeItem: function (k) { delete store[k]; },
		clear: function () { store = {}; }
	};
}

function makeDomStub() {
	var localStorage = makeLocalStorage();
	var document = {
		createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; },
		getElementById: function () { return null; },
		body: { appendChild: function () {} }
	};
	var window = { localStorage: localStorage, document: document };

	function XMLHttpRequest() {
		this.readyState = 0;
	}
	XMLHttpRequest.prototype.open = function () {};
	XMLHttpRequest.prototype.send = function () {};
	XMLHttpRequest.prototype.setRequestHeader = function () {};

	return { document: document, window: window, localStorage: localStorage, XMLHttpRequest: XMLHttpRequest };
}

module.exports = { makeDomStub: makeDomStub };
