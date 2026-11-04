import fs from "node:fs";
import path from "node:path";

/**
 * pdf.js's worker and the data it loads, served at /pdfjs/ for the cheat
 * sheet studio. The page bundles pdf.js from the same package, so the
 * worker's version always matches. Its scripting engine is never served.
 */
const DIST = path.join(process.cwd(), "node_modules", "pdfjs-dist");
const FILES: { pattern: RegExp; dir: string; type: string }[] = [
	{ pattern: /^pdf\.worker\.min\.mjs$/, dir: "build", type: "text/javascript; charset=utf-8" },
	{ pattern: /^standard_fonts\/[A-Za-z0-9_-]+\.(pfb|ttf)$/, dir: "", type: "application/octet-stream" },
	{ pattern: /^cmaps\/[A-Za-z0-9_-]+\.bcmap$/, dir: "", type: "application/octet-stream" },
	{ pattern: /^iccs\/[A-Za-z0-9_-]+\.icc$/, dir: "", type: "application/octet-stream" },
	{ pattern: /^wasm\/(jbig2|openjpeg|qcms_bg)\.wasm$/, dir: "", type: "application/wasm" },
	{ pattern: /^wasm\/(jbig2|openjpeg)_nowasm_fallback\.js$/, dir: "", type: "text/javascript; charset=utf-8" },
];

/** The file and its type, or null for anything else. */
export function pdfjsAsset(parts: readonly string[]): { body: Buffer; type: string } | null {
	const name = parts.join("/");
	const file = FILES.find((f) => f.pattern.test(name));
	if (!file) return null;
	try {
		return { body: fs.readFileSync(path.join(DIST, file.dir, name)), type: file.type };
	} catch {
		return null;
	}
}
