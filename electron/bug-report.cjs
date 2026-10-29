"use strict";

const OS_NAMES = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** A new-issue link with an empty report template. Only the app version and
 * OS go in, never anything from the user's data. */
function bugReportURL({ version, platform, systemVersion, arch }) {
	const os = `${OS_NAMES[platform] ?? platform} ${systemVersion} ${arch}`;
	const body = [
		"### What happened", "",
		"### What you expected", "",
		"### Steps to reproduce", "",
		"---",
		`godspeed ${version} · ${os}`,
	].join("\n");
	return `https://github.com/bayshores/godspeed/issues/new?body=${encodeURIComponent(body)}`;
}

module.exports = { bugReportURL };
