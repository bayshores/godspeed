/**
 * How the agent's screen looks: xterm's colors and font, from the app's
 * tokens. The bar's paper and ink, the highlighter for the cursor and the
 * selection, and ANSI colors from the space colors, toned toward the ink so
 * they sit on the bar like the rest of the app.
 */
import type { ITerminalOptions, ITheme } from "@xterm/xterm";

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const LINE_HEIGHT = 1.35;

type Rgb = [number, number, number];

/** Any CSS color as RGB, read back from a probe element. */
function rgb(color: string): Rgb {
	const probe = document.createElement("i");
	probe.style.color = color;
	document.body.append(probe);
	// A page without computed styles (the tests' DOM) reads as black.
	const read = `${getComputedStyle(probe).color}`;
	probe.remove();
	const [r = 0, g = 0, b = 0] = (read.match(/[\d.]+/g) ?? []).map(Number);
	return [r, g, b];
}

const hex = (c: Rgb, alpha?: number) =>
	`#${[...c, ...(alpha === undefined ? [] : [Math.round(alpha * 255)])].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

/** `a` with `share` of `b` mixed in. */
const mix = (a: Rgb, b: Rgb, share: number): Rgb => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * share) as Rgb;

function screenTheme(style: CSSStyleDeclaration): ITheme {
	const v = (name: string) => rgb(style.getPropertyValue(name).trim());
	const bar = v("--lh-bar");
	const ink = v("--lh-bar-ink");
	const highlight = v("--lh-highlight");
	// A space color a fifth of the way to the ink: muted, and readable on the bar.
	const tone = (n: number) => hex(mix(v(`--lh-space-${n}`), ink, 0.2));
	const colors = { red: tone(4), green: tone(3), yellow: tone(5), blue: tone(1), magenta: tone(2), cyan: tone(6) };
	return {
		background: hex(bar),
		foreground: hex(ink),
		cursor: hex(highlight),
		cursorAccent: hex(bar),
		selectionBackground: hex(highlight, 0.3),
		black: hex(bar),
		white: hex(ink),
		brightBlack: hex(mix(bar, ink, 0.6)),
		brightWhite: hex(mix(ink, [255, 255, 255], 0.3)),
		...colors,
		brightRed: colors.red,
		brightGreen: colors.green,
		brightYellow: colors.yellow,
		brightBlue: colors.blue,
		brightMagenta: colors.magenta,
		brightCyan: colors.cyan,
	};
}

/** xterm's look, read from the page's tokens when a screen opens. */
export function screenLook(): ITerminalOptions {
	const style = getComputedStyle(document.documentElement);
	return {
		fontFamily: style.getPropertyValue("--font-mono").trim() || MONO,
		lineHeight: LINE_HEIGHT,
		theme: screenTheme(style),
		cursorStyle: "block",
		cursorBlink: false,
		minimumContrastRatio: 4.5,
	};
}
