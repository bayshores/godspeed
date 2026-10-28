"use strict";

const HEADER = "x-godspeed-desktop";

/** Called for EVERY outgoing request, so redirects cannot carry the secret
 * to another origin. Never expose this function or its secret to preload. */
function desktopAPIHeaders(details, origin, secret, windows) {
	const headers = { ...details.requestHeaders };
	for (const name of Object.keys(headers)) if (name.toLowerCase() === HEADER) delete headers[name];
	if (!secret) return headers;
	try {
		const target = new URL(details.url);
		if (target.origin !== origin || target.username || target.password || !(target.pathname === "/api" || target.pathname.startsWith("/api/"))) return headers;
		const win = windows.find((candidate) => !candidate.isDestroyed() && candidate.webContents.id === details.webContentsId);
		if (!win || win.webContents.isDestroyed()) return headers;
		const contents = win.webContents;
		if (details.webContents && details.webContents !== contents) return headers;
		if (!details.frame || details.frame !== contents.mainFrame) return headers;
		if (new URL(contents.mainFrame.url).origin !== origin) return headers;
		if (details.initiatorOrigin !== undefined && details.initiatorOrigin !== origin) return headers;
		headers[HEADER] = secret;
	} catch { /* Missing/destroyed/navigated frames fail closed. */ }
	return headers;
}
/** Sender must be the trusted window's main frame at its exact app origin. */
function trustedSender(event, origin, BrowserWindow) {
	const win = BrowserWindow.fromWebContents(event.sender);
	try {
		return !!win && event.senderFrame === event.sender.mainFrame && new URL(event.senderFrame.url).origin === origin;
	} catch { return false; }
}
module.exports = { desktopAPIHeaders, trustedSender, HEADER };
