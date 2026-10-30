"use strict";

const path = require("node:path");

// openExternal hands any registered scheme to the OS (smb:, search-ms:, app
// handlers), so only plain web and mail links leave the app.
const WEB_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isWebLink(target) {
	try {
		return WEB_PROTOCOLS.has(new URL(target).protocol);
	} catch {
		return false;
	}
}

// macOS treats these folders as packages: opening one launches or installs it.
const BUNDLE_NAME = /\.(app|appex|bundle|framework|kext|mdimporter|mpkg|pkg|plugin|prefpane|qlgenerator|saver|workflow|xpc)$/i;

function isAppBundle(folder) {
	return BUNDLE_NAME.test(path.basename(folder));
}

module.exports = { isWebLink, isAppBundle };
