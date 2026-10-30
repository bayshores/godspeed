import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isWebLink, isAppBundle } = require("../electron/open-guards.cjs");

test("only http, https and mailto links go to the browser", () => {
	for (const link of ["https://example.com/a", "http://example.com", "mailto:me@example.com"]) assert.equal(isWebLink(link), true, link);
	for (const link of [
		"smb://attacker.example/share",
		"search-ms:query=x&crumb=location:\\\\attacker\\share",
		"file:///Applications/Utilities/Terminal.app",
		"vscode://file/etc/passwd",
		"x-apple.systempreferences:com.apple.preference.security",
		"javascript:alert(1)",
		"not a url",
		"",
	]) assert.equal(isWebLink(link), false, link);
});

test("macOS bundle folders are told apart from plain folders", () => {
	for (const folder of ["/Applications/Utilities/Terminal.app", "/Users/me/Downloads/Installer.APP", "/Library/PreferencePanes/X.prefPane", "/x/Y.bundle", "/Users/me/Downloads/Setup.pkg"]) assert.equal(isAppBundle(folder), true, folder);
	for (const folder of ["/Users/me/CSE 21", "/Users/me/notes.app.d", "/Users/me/app", "/Users/me/Foo.app/Contents"]) assert.equal(isAppBundle(folder), false, folder);
});
