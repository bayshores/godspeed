import type { IDecoration, Terminal } from "@xterm/xterm";
import { lineText, screenLinks, type LinkFile, type ScreenLink } from "./terminal-links-model";

export interface Linking {
	files: readonly LinkFile[];
	onLink: (link: ScreenLink) => void;
}

/** The links on buffer line `y` (from 0), with their first and last screen columns (from 1). */
function linksOn(t: Terminal, y: number, files: readonly LinkFile[]) {
	const line = t.buffer.active.getLine(y);
	if (!line) return [];
	const cells = Array.from({ length: line.length }, (_, x) => line.getCell(x)).map((c) => ({ chars: c?.getChars() ?? "", width: c?.getWidth() ?? 1 }));
	const { text, columns } = lineText(cells);
	return screenLinks(text, files).map((link) => ({ link, text: text.slice(link.start, link.end), from: columns[link.start]!, to: columns[link.end - 1]! }));
}

/**
 * Space file names and passage ids in the screen: each has a dotted line
 * under it while it is in view (redrawn shortly after output or a scroll,
 * so a busy screen is read once per burst), and a click opens it. The
 * lines are xterm decorations, which need `allowProposedApi`.
 */
export function linkScreen(t: Terminal, linking: { current: Linking }) {
	const provider = t.registerLinkProvider({
		provideLinks(y, done) {
			const found = linksOn(t, y - 1, linking.current.files);
			done(
				found.length === 0
					? undefined
					: found.map((f) => ({
							range: { start: { x: f.from, y }, end: { x: f.to, y } },
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
				const marker = t.registerMarker(y - buffer.baseY - buffer.cursorY);
				const mark = marker && t.registerDecoration({ marker, x: f.from - 1, width: f.to - f.from + 1 });
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
