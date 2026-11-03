/**
 * A cheat sheet block's body as lines for the paper: plain lines, "- "
 * bullets, "1." steps and display math ($$…$$ or \[…\], over one or more
 * lines), each line split into text, **bold** and inline math ($…$ or
 * \(…\)). A small, fixed subset, so the paper's spacing stays exact and
 * measurable. Pure and browser-safe.
 */

export type SheetPiece = { kind: "text"; text: string; bold?: true } | { kind: "math"; tex: string };

type SheetLine = { kind: "text" | "bullet" | "step"; pieces: SheetPiece[]; marker?: string } | { kind: "display"; tex: string };

const INLINE = /\$([^$\n]+?)\$|\\\((.+?)\\\)/g;
const BOLD = /\*\*(.+?)\*\*/g;

function textPieces(text: string): SheetPiece[] {
	const out: SheetPiece[] = [];
	let last = 0;
	for (const m of text.matchAll(BOLD)) {
		if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
		out.push({ kind: "text", text: m[1]!, bold: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
	return out;
}

/** One line split into text, bold and inline math. */
function sheetPieces(line: string): SheetPiece[] {
	const out: SheetPiece[] = [];
	let last = 0;
	for (const m of line.matchAll(INLINE)) {
		if (m.index > last) out.push(...textPieces(line.slice(last, m.index)));
		out.push({ kind: "math", tex: (m[1] ?? m[2] ?? "").trim() });
		last = m.index + m[0].length;
	}
	if (last < line.length) out.push(...textPieces(line.slice(last)));
	return out;
}

const DISPLAY_OPEN = /^(\$\$|\\\[)/;
const closerOf = (open: string) => (open === "$$" ? "$$" : "\\]");

export function sheetText(body: string): SheetLine[] {
	const lines = body.replace(/\r\n?/g, "\n").split("\n");
	const out: SheetLine[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.trim();
		if (!line) continue;
		const open = DISPLAY_OPEN.exec(line)?.[1];
		if (open) {
			const close = closerOf(open);
			let tex = line.slice(open.length);
			while (!tex.trimEnd().endsWith(close) && i + 1 < lines.length) tex += `\n${lines[++i]}`;
			tex = tex.trimEnd();
			if (tex.endsWith(close)) tex = tex.slice(0, -close.length);
			out.push({ kind: "display", tex: tex.trim() });
			continue;
		}
		const bullet = /^[-*•]\s+(.*)$/.exec(line);
		if (bullet) {
			out.push({ kind: "bullet", pieces: sheetPieces(bullet[1]!) });
			continue;
		}
		const step = /^(\d+[.)])\s+(.*)$/.exec(line);
		if (step) {
			out.push({ kind: "step", marker: step[1]!, pieces: sheetPieces(step[2]!) });
			continue;
		}
		out.push({ kind: "text", pieces: sheetPieces(line) });
	}
	return out;
}
