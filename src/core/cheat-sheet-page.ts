/**
 * One cheat sheet page as the studio shows and prints it: the agent's
 * HTML, cleaned of anything that runs or loads, its LaTeX rendered with
 * KaTeX, inside a whole document of the page's exact size for a sandboxed
 * iframe. The sandbox (no scripts) and the document's CSP are the real
 * guard; the cleaning is a second one. Pure and browser-safe.
 */
import katex from "katex";
import { pageSizeCss, type CheatSheetDoc } from "./cheat-sheet.ts";

/** KaTeX's stylesheet and fonts, served by the app (no network needed). */
const KATEX_CSS_URL = "/katex/katex.min.css";

/** CSS pixels per inch. */
export const PX_PER_IN = 96;

const DROPPED_WITH_CONTENT = /<(script|iframe|object|frameset|applet|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;
const DROPPED_TAGS = /<\/?(script|iframe|object|embed|frame|frameset|applet|base|meta|link|noscript|template|portal)\b[^>]*>/gi;
const URL_ATTRS = new Set(["href", "src", "srcset", "xlink:href", "action", "formaction", "poster", "background", "data", "ping"]);
const ATTR = /\s+([^\s"'=<>/]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/** A tag with its event handlers and outside links taken out. */
function cleanTag(tag: string): string {
	const m = /^<([a-zA-Z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(tag);
	if (!m) return tag;
	const attrs = (m[2] ?? "").replace(ATTR, (all: string, name: string, _eq: string | undefined, value: string | undefined) => {
		const key = name.toLowerCase();
		if (key.startsWith("on")) return "";
		if (!URL_ATTRS.has(key)) return all;
		const url = (value ?? "").replace(/^["']|["']$/g, "").trim().toLowerCase();
		return url.startsWith("#") || url.startsWith("data:image/") ? all : "";
	});
	return `<${m[1]}${attrs}${m[3]}>`;
}

/** The agent's HTML without scripts, frames, event handlers or outside links. */
export function cleanSheetHtml(html: string): string {
	return html
		.replace(DROPPED_WITH_CONTENT, "")
		.replace(DROPPED_TAGS, "")
		.replace(/<[a-zA-Z][^>]*>/g, cleanTag);
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function texOf(source: string): string {
	return source.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e).trim();
}

function renderTex(source: string, displayMode: boolean): string {
	return katex.renderToString(texOf(source), { displayMode, throwOnError: false });
}

/** Elements whose text is never math. */
const RAW = new Set(["style", "script", "textarea", "title"]);
const NO_MATH = new Set(["code", "pre"]);
const MAX_INLINE = 2000;

/** Where inline $…$ closes: not after a space, not before a digit (so
 *  "$5 and $10" stays money), never across a closing tag or blank line. */
function inlineClose(html: string, from: number): number {
	for (let j = from; j < html.length && j - from < MAX_INLINE; j++) {
		const c = html[j];
		if (c === "\\") {
			j++;
			continue;
		}
		if (c === "<" && html[j + 1] === "/") return -1;
		if (c === "\n" && html[j + 1] === "\n") return -1;
		if (c === "$") return /\s/.test(html[j - 1] ?? "") || /\d/.test(html[j + 1] ?? "") ? -1 : j;
	}
	return -1;
}

/** $…$, $$…$$, \(…\) and \[…\] in the page's text rendered with KaTeX;
 *  tags, attributes, code and SVG (outside a foreignObject) left alone.
 *  \$ is a dollar sign. */
export function renderSheetMath(html: string): string {
	let out = "";
	let i = 0;
	let svg = 0;
	let foreign = 0;
	let code = 0;
	while (i < html.length) {
		const c = html[i]!;
		if (c === "<" && /[a-zA-Z!/]/.test(html[i + 1] ?? "")) {
			if (html.startsWith("<!--", i)) {
				const end = html.indexOf("-->", i + 4);
				const stop = end < 0 ? html.length : end + 3;
				out += html.slice(i, stop);
				i = stop;
				continue;
			}
			const end = html.indexOf(">", i);
			const stop = end < 0 ? html.length : end + 1;
			const tag = html.slice(i, stop);
			out += tag;
			i = stop;
			const m = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(tag);
			if (!m) continue;
			const name = m[2]!.toLowerCase();
			const closing = m[1] === "/";
			const selfClosing = tag.endsWith("/>");
			if (!closing && RAW.has(name)) {
				const close = html.toLowerCase().indexOf(`</${name}`, i);
				const to = close < 0 ? html.length : close;
				out += html.slice(i, to);
				i = to;
				continue;
			}
			const step = selfClosing ? 0 : closing ? -1 : 1;
			if (name === "svg") svg = Math.max(0, svg + step);
			else if (name === "foreignobject") foreign = Math.max(0, foreign + step);
			else if (NO_MATH.has(name)) code = Math.max(0, code + step);
			continue;
		}
		const mathOn = code === 0 && (svg === 0 || foreign > 0);
		if (mathOn && c === "\\" && html[i + 1] === "$") {
			out += "$";
			i += 2;
			continue;
		}
		if (mathOn && c === "\\" && (html[i + 1] === "(" || html[i + 1] === "[")) {
			const display = html[i + 1] === "[";
			const end = html.indexOf(display ? "\\]" : "\\)", i + 2);
			if (end > 0) {
				out += renderTex(html.slice(i + 2, end), display);
				i = end + 2;
				continue;
			}
		}
		if (mathOn && c === "$" && html[i + 1] === "$") {
			const end = html.indexOf("$$", i + 2);
			if (end > i + 2) {
				out += renderTex(html.slice(i + 2, end), true);
				i = end + 2;
				continue;
			}
		}
		if (mathOn && c === "$" && /\S/.test(html[i + 1] ?? " ")) {
			const end = inlineClose(html, i + 1);
			if (end > 0) {
				out += renderTex(html.slice(i + 1, end), false);
				i = end + 1;
				continue;
			}
		}
		out += c;
		i++;
	}
	return out;
}

/** The page's base: its exact size, black on white, a plain small font.
 *  The agent's CSS comes after and may change any of it. */
function baseCss(doc: Pick<CheatSheetDoc, "widthIn" | "heightIn">): string {
	return [
		`@page { size: ${pageSizeCss(doc)}; margin: 0; }`,
		`html { width: ${doc.widthIn}in; height: ${doc.heightIn}in; overflow: hidden; background: #fff; }`,
		"html, body { margin: 0; }",
		'body { min-height: 100%; box-sizing: border-box; color: #000; background: #fff; font: 9pt/1.25 "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
		"*, *::before, *::after { box-sizing: border-box; }",
		"svg { max-width: 100%; }",
	].join("\n");
}

const CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:";

/** A page as a whole document for the iframe's srcdoc (pages counted from 0). */
export function sheetPageDocument(doc: CheatSheetDoc, page: number): string {
	const css = doc.css.replace(/<\/style/gi, "<\\/style");
	return [
		"<!doctype html>",
		'<html><head><meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
		`<link rel="stylesheet" href="${KATEX_CSS_URL}">`,
		`<style>${baseCss(doc)}</style>`,
		`<style>${css}</style>`,
		`</head><body>${renderSheetMath(cleanSheetHtml(doc.pages[page] ?? ""))}</body></html>`,
	].join("\n");
}
