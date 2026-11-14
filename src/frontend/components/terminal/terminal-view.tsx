/**
 * One terminal's live screen (xterm.js, loaded with this file only when a
 * screen first shows). Fixed at 100 by 30; the font scales to the box.
 * While it has focus every key goes to the agent: none reaches the app's
 * shortcuts (Escape never stops a turn, Tab never leaves), except the
 * Mac's Command keys. Links open in the browser.
 */
import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { COLS, ROWS, fitFontSize } from "./terminal-model";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

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

/** The app's colors as xterm needs them: the top bar's ink and paper,
 *  and the space colors where the agent's own output uses color. */
function screenTheme(style: CSSStyleDeclaration): ITheme {
	const v = (name: string) => style.getPropertyValue(name).trim();
	const bar = v("--lh-bar");
	const ink = v("--lh-bar-ink");
	const space = (n: number) => v(`--lh-space-${n}`);
	const colors = { red: space(4), green: space(3), yellow: space(5), blue: space(1), magenta: space(2), cyan: space(6) };
	return {
		background: bar,
		foreground: ink,
		cursor: ink,
		cursorAccent: bar,
		selectionBackground: `${ink}55`,
		black: bar,
		white: ink,
		brightBlack: v("--border"),
		brightWhite: ink,
		...colors,
		brightRed: colors.red,
		brightGreen: colors.green,
		brightYellow: colors.yellow,
		brightBlue: colors.blue,
		brightMagenta: colors.magenta,
		brightCyan: colors.cyan,
	};
}

/** Keeps a key in the screen; the Mac's Command keys still reach the app (copy, zoom). */
function keepKey(e: KeyboardEvent) {
	if (e.metaKey && document.documentElement.dataset.lhPlatform === "darwin") return;
	e.stopPropagation();
}

export function TerminalView({ id, ended, focusOnOpen, focusKey }: {
	id: string;
	/** The agent has ended: the screen stays, greyed, and takes no keys. */
	ended: boolean;
	/** The learner opened it: it takes the keyboard at once. Otherwise a
	 *  click in the screen does. */
	focusOnOpen: boolean;
	/** Focus moves back to the screen whenever this goes up. */
	focusKey: number;
}) {
	const box = useRef<HTMLDivElement>(null);
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<Terminal | null>(null);

	useEffect(() => {
		const lh = window.lh?.terminals;
		const el = host.current;
		const frame = box.current;
		if (!lh || !el || !frame) return;
		const style = getComputedStyle(document.documentElement);
		const t = new Terminal({
			cols: COLS,
			rows: ROWS,
			scrollback: 1000,
			fontFamily: style.getPropertyValue("--font-mono").trim() || MONO,
			fontSize: fitFontSize(...inside(frame)),
			theme: screenTheme(style),
			minimumContrastRatio: 4.5,
			linkHandler: { activate: (_e, url) => void window.lh?.openLink?.(url) },
		});
		t.loadAddon(new WebLinksAddon((_e, url) => void window.lh?.openLink?.(url)));
		t.open(el);
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

	return (
		<div ref={box} data-testid="terminal-screen" className="min-h-0 min-w-0 flex-1 overflow-auto bg-bar p-3 max-[600px]:p-2">
			<div ref={host} data-terminal-screen="" className={ended ? "w-max opacity-60" : "w-max"} />
		</div>
	);
}
