// Minimal, dependency-free .env.local loader. Silently sets whatever
// KEY=VALUE pairs it finds onto process.env -- never logs, prints, or
// returns the parsed values themselves. Safe to require unconditionally;
// a missing file is a no-op (tests that need credentials should check
// `process.env.MLB_USERNAME`/`MLB_PASSWORD` directly and skip/report
// clearly if absent, not fail with a confusing downstream error).
const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
	const envPath = path.join(__dirname, ".env.local");
	if (!fs.existsSync(envPath)) {
		return;
	}

	const content = fs.readFileSync(envPath, "utf8");
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed || trimmed.charAt(0) === "#") {
			continue;
		}
		const eq = trimmed.indexOf("=");
		if (eq === -1) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (key && !(key in process.env)) {
			process.env[key] = value;
		}
	}
}

module.exports = { loadEnvLocal };
