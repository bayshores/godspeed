import fs from "node:fs";
import path from "node:path";

/**
 * KaTeX's stylesheet and fonts for the cheat sheet's pages: each page is
 * its own document in a sandboxed frame, so it links them itself
 * (core KATEX_CSS_URL), from the app, never the network.
 */
const DIST = path.join(process.cwd(), "node_modules", "katex", "dist");
const ALLOWED = /^(katex\.min\.css|fonts\/KaTeX_[A-Za-z0-9_-]+\.woff2)$/;

/** The file and its type, or null for anything else. */
export function katexAsset(parts: readonly string[]): { body: Buffer; type: string } | null {
	const name = parts.join("/");
	if (!ALLOWED.test(name)) return null;
	try {
		return { body: fs.readFileSync(path.join(DIST, name)), type: name.endsWith(".css") ? "text/css; charset=utf-8" : "font/woff2" };
	} catch {
		return null;
	}
}
