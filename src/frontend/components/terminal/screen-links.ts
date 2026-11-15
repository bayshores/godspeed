import type { IDecoration, Terminal } from "@xterm/xterm";
import { rowLinks, type LinkFile, type Row, type ScreenLink } from "./terminal-links-model";

export interface Linking {
	files: readonly LinkFile[];
	onLink: (link: ScreenLink) => void;
}

/** How far above and below a row a name that runs over rows may start or end. */
const REACH = 2;

/** The links that cover buffer row `y` (from 0), read with the rows around it. */
function linksOn(t: Terminal, y: number, files: readonly LinkFile[]) {
	const first = Math.max(0, y - REACH);
	const rows: Row[] = [];
	for (let r = first; r <= y + REACH; r++) {
		const line = t.buffer.active.getLine(r);
		if (!line) break;
		const cells = Array.from({ length: line.length }, (_, x) => line.getCell(x)).map((c) => ({ chars: c?.getChars() ?? "", width: c?.getWidth() ?? 1 }));
		rows.push({ cells, wrapped: line.isWrapped });
	}
	return rowLinks(rows, first, files).filter((l) => l.parts.some((p) => p.row === y));
}

/**
 * Space file names and passage ids in the screen, also one that runs on to
 * the next row: each has a dotted line under it while it is in view
 * (redrawn shortly after output or a scroll, so a busy screen is read once
 * per burst), and a click opens it. The lines are xterm decorations, which
 * need `allowProposedApi`.
 */
export function linkScreen(t: Terminal, linking: { current: Linking }) {
	const provider = t.registerLinkProvider({
		provideLinks(y, done) {
			const found = linksOn(t, y - 1, linking.current.files);
			done(
				found.length === 0
					? undefined
					: found.map((f) => ({
							range: { start: { x: f.parts[0]!.from, y: f.parts[0]!.row + 1 }, end: { x: f.parts.at(-1)!.to, y: f.parts.at(-1)!.row + 1 } },
							text: f.text,
							activate: () => linking.current.onLink(f.link),
						})),
			);
		},
	});
	let marks: IDecoration[] = [];
	const clear = () => {
		for (const mark of marks) {
			mark.marker.dispose();
			mark.dispose();
		}
		marks = [];
	};
	const underline = () => {
		clear();
		const buffer = t.buffer.active;
		for (let y = buffer.viewportY; y < buffer.viewportY + t.rows; y++) {
			for (const f of linksOn(t, y, linking.current.files)) {
				const part = f.parts.find((p) => p.row === y)!;
				const marker = t.registerMarker(y - buffer.baseY - buffer.cursorY);
				const mark = marker && t.registerDecoration({ marker, x: part.from - 1, width: part.to - part.from + 1 });
				if (!mark) {
					marker?.dispose();
					continue;
				}
				mark.onRender((el) => el.classList.add("lh-screen-link"));
				marks.push(mark);
			}
		}
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const soon = () => {
		clearTimeout(timer);
		timer = setTimeout(underline, 120);
	};
	const parsed = t.onWriteParsed(soon);
	const scrolled = t.onScroll(soon);
	return {
		/** The list of names changed. */
		refresh: soon,
		dispose() {
			clearTimeout(timer);
			parsed.dispose();
			scrolled.dispose();
			provider.dispose();
			clear();
		},
	};
}
