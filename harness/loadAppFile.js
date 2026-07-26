// Loads a real, unmodified app source file (from app/extracted/.../{lib,data}/*.js)
// into an isolated vm context stocked with the minimal enyo/dom stubs, so
// harness tests exercise the real app code rather than a reimplementation of
// its logic. Returns the vm context -- pull named globals the file defines
// (e.g. ctx.ScoreboardParser) off of it after loading.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeEnyo } = require("./stubs/enyoStub");
const { makeDomStub } = require("./stubs/domStub");

const APP_ROOT = path.join(
	__dirname,
	"..",
	"app",
	"extracted",
	"usr",
	"palm",
	"applications",
	"com.mlb.atbat2011"
);

function loadAppFile(relativePath, existingContext) {
	const fullPath = path.join(APP_ROOT, relativePath);
	const source = fs.readFileSync(fullPath, "utf8");

	const dom = makeDomStub();
	const sandbox = existingContext || {
		enyo: makeEnyo(),
		console: console,
		document: dom.document,
		window: dom.window,
		localStorage: dom.localStorage,
		XMLHttpRequest: dom.XMLHttpRequest,
		fetch: fetch
	};
	sandbox.global = sandbox;

	const context = vm.createContext(sandbox);
	vm.runInContext(source, context, { filename: fullPath });
	return context;
}

module.exports = { loadAppFile: loadAppFile, APP_ROOT: APP_ROOT };
