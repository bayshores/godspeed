/**
 * One terminal's live screen (xterm.js, loaded with this file only when a
 * screen first shows). Fixed at 80 by 30; the font scales to the box.
 * While it has focus every key goes to the agent: none reaches the app's
 * shortcuts (Escape never stops a turn, Tab never leaves), except the
 * Mac's Command keys. Web links open in the browser; space file names
 * and passage ids go to `onLink`.
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { COLS, ROWS, fitFontSize } from "./terminal-model";
import { screenLook } from "./terminal-theme";
import type { LinkFile, ScreenLink } from "./terminal-links-model";
import { linkScreen, type Linking } from "./screen-links";

/** Block and line characters drawn cell to cell, as a terminal app draws them: the font
 *  leaves gaps between them at this line height. Without WebGL the font draws them. */
function drawBlocks(t: Terminal) {
	try {
		const gl = new WebglAddon();
		gl.onContextLoss(() => gl.dispose());
		t.loadAddon(gl);
	} catch {
		// No WebGL here: xterm keeps its own renderer.
	}
}

/** The box's width and height inside its padding, where the screen goes. */
function inside(box: HTMLElement): [number, number] {
	const s = getComputedStyle(box);
	const pad = (a: string, b: string) => (parseFloat(s.getPropertyValue(a)) || 0) + (parseFloat(s.getPropertyValue(b)) || 0);
	return [box.clientWidth - pad("padding-left", "padding-right"), box.clientHeight - pad("padding-top", "padding-bottom")];
}

function bytes(base64: string): Uint8Array {
	const raw = atob(base64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** Keeps a key in the screen; the Mac's Command keys still reach the app (copy, zoom). */
function keepKey(e: KeyboardEvent) {
	if (e.metaKey && document.documentElement.dataset.lhPlatform === "darwin") return;
	e.stopPropagation();
}

export function TerminalView({ id, ended, focusOnOpen, focusKey, files, onLink }: {
	id: string;
	/** The agent has ended: the screen stays, greyed, and takes no keys. */
	ended: boolean;
	/** The learner opened it: it takes the keyboard at once. Otherwise a
	 *  click in the screen does. */
	focusOnOpen: boolean;
	/** Focus moves back to the screen whenever this goes up. */
	focusKey: number;
	/** The space files whose names link. */
	files: readonly LinkFile[];
	onLink: (link: ScreenLink) => void;
}) {
	const box = useRef<HTMLDivElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<Terminal | null>(null);
	// The screen lives as long as its id; its links read the newest list and handler.
	const linking = useRef<Linking>({ files, onLink });
	const relink = useRef<(() => void) | null>(null);
	useEffect(() => {
		linking.current = { files, onLink };
		relink.current?.();
	}, [files, onLink]);

	useEffect(() => {
		const lh = window.lh?.terminals;
		const el = host.current;
		const frame = box.current;
		if (!lh || !el || !frame) return;
		const t = new Terminal({
			...screenLook(),
			cols: COLS,
			rows: ROWS,
			scrollback: 1000,
			// The links' dotted lines are decorations, still proposed API in xterm 6.
			allowProposedApi: true,
			fontSize: fitFontSize(...inside(frame)),
			linkHandler: { activate: (_e, url) => void window.lh?.openLink?.(url) },
		});
		t.loadAddon(new WebLinksAddon((_e, url) => void window.lh?.openLink?.(url)));
		const links = linkScreen(t, linking);
		relink.current = links.refresh;
		t.open(el);
		drawBlocks(t);
		term.current = t;
		// A key the shell refuses (the window lost focus, the agent ended) is dropped.
		const typed = t.onData((data) => lh.write(id, data).catch(() => {}));
		const offOutput = lh.onOutput((out) => {
			if (out.id !== id) return;
			if (out.snapshot !== undefined) {
				t.reset();
				t.write(bytes(out.snapshot));
			}
			if (out.data) t.write(bytes(out.data));
		});
		lh.attach(id).catch(() => {/* it ended: the screen stays empty */});
		el.addEventListener("keydown", keepKey);
		// Too small a box even at the smallest font keeps the bottom in view: the agent's input and status lines.
		const fit = new ResizeObserver(() => {
			t.options.fontSize = fitFontSize(...inside(frame));
			frame.scrollTop = frame.scrollHeight;
		});
		fit.observe(frame);
		return () => {
			fit.disconnect();
			links.dispose();
			relink.current = null;
			el.removeEventListener("keydown", keepKey);
			offOutput();
			typed.dispose();
			lh.detach(id).catch(() => {});
			t.dispose();
			term.current = null;
		};
	}, [id]);

	useEffect(() => {
		const t = term.current;
		if (!t) return;
		t.options.disableStdin = ended;
		t.options.cursorInactiveStyle = ended ? "none" : "outline";
	}, [ended]);

	useEffect(() => {
		if (!ended && (focusOnOpen || focusKey > 0)) term.current?.focus();
	}, [focusKey, focusOnOpen, ended, id]);

	// A card on the panel's paper. Its padding is the screen's only inset:
	// the font fit reads it, so text, cursor and links share one column.
	return (
		<div className="mx-3 mb-3 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[10px] bg-bar">
			<div ref={box} data-testid="terminal-screen" className="lh-screen min-h-0 min-w-0 flex-1 overflow-auto px-[18px] py-3.5 max-[600px]:px-3">
				<div ref={host} data-terminal-screen="" className={ended ? "w-max opacity-60" : "w-max"} />
			</div>
		</div>
	);
}
