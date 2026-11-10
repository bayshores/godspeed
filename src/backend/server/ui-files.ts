import fs from "node:fs";
import path from "node:path";

/**
 * The window's screens: the built UI (`vite build`, run by `npm run build`,
 * makes dist-ui/; scripts/build-server.mjs copies it to ui/ beside
 * server.js). A path with a file extension is that file; any other path
 * gets index.html, so the UI's router picks the screen.
 * Kept light like boot.ts: it answers the window's first request.
 */
const ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "ui");
const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".png": "image/png",
	".mp3": "audio/mpeg",
};
/** Built files carry a content hash in their name, so they never change. */
const HASHED = "public, max-age=31536000, immutable";

/** The file to answer `parts` with, or null for a 404. */
export function uiFile(parts: readonly string[]): { body: Buffer; type: string; cache: string } | null {
	// An unknown API path stays a 404, never the page.
	if (parts[0] === "api") return null;
	const name = parts.join("/");
	const ext = path.extname(name).toLowerCase();
	if (ext) {
		const file = path.resolve(/* turbopackIgnore: true */ ROOT, name);
		if (!file.startsWith(ROOT + path.sep)) return null;
		try {
			const type = TYPES[ext] ?? "application/octet-stream";
			return { body: fs.readFileSync(/* turbopackIgnore: true */ file), type, cache: name.startsWith("assets/") ? HASHED : "no-cache" };
		} catch {
			return null;
		}
	}
	try {
		return { body: fs.readFileSync(/* turbopackIgnore: true */ path.join(ROOT, "index.html")), type: TYPES[".html"]!, cache: "no-cache" };
	} catch {
		return null;
	}
}
