/**
 * Text colors that read well on any background. Light or dark text is
 * picked by which has more contrast; each text level starts from the
 * default gray, takes a hint of the background's hue (in OKLCH, so the
 * tint looks even across colors), then moves lighter or darker until it
 * meets its contrast minimum. Browser-safe, pure.
 */

export type InkLevel = "text" | "body" | "muted" | "faint";

/** Each level's contrast minimum (WCAG ratio) and its default grays, on dark and on light backgrounds. */
const LEVELS: Record<InkLevel, { min: number; onDark: string; onLight: string }> = {
	text: { min: 7, onDark: "#e6e6e6", onLight: "#1a1a1a" },
	body: { min: 6, onDark: "#cfcfcf", onLight: "#2b2b2b" },
	muted: { min: 4.5, onDark: "#8d8d8d", onLight: "#5f5f5f" },
	faint: { min: 3, onDark: "#6e6e6e", onLight: "#7b7b7b" },
};

/** How much of the background's hue text takes (OKLCH chroma). */
const TINT = 0.03;

type Rgb = [number, number, number];

function channels(hex: string): Rgb {
	const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7);
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

function toHex(rgb: Rgb): string {
	return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Every channel moved by `delta` (in 0..255 steps), clamped. */
export function shiftHex(hex: string, delta: number): string {
	return toHex(channels(hex).map((c) => c + delta / 255) as Rgb);
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);

interface Oklch {
	l: number;
	c: number;
	h: number;
}

function toOklch(hex: string): Oklch {
	const [r, g, b] = channels(hex).map(toLinear) as Rgb;
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

function fromOklch({ l, c, h }: Oklch): string {
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return toHex([
		toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
		toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
		toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
	]);
}

function luminance(hex: string): number {
	const [r, g, b] = channels(hex).map(toLinear) as Rgb;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** True when dark text reads better than light text on this color. */
export function wantsDarkText(background: string): boolean {
	return contrast("#000000", background) >= contrast("#ffffff", background);
}

/** `color` moved lighter (or darker, `darker`) in small steps, keeping its
 *  hue, until it has `min` contrast on every surface. Stops at white or black. */
function reach(color: string, surfaces: readonly string[], min: number, darker: boolean): string {
	const start = toOklch(color);
	let out = color;
	for (let l = start.l; !surfaces.every((s) => contrast(out, s) >= min); ) {
		l += darker ? -0.01 : 0.01;
		if (l <= 0 || l >= 1) return darker ? "#000000" : "#ffffff";
		// The tint fades as the color nears white or black, so it stays in gamut.
		const room = darker ? l / start.l : (1 - l) / (1 - start.l);
		out = fromOklch({ l, c: start.c * Math.min(1, room), h: start.h });
	}
	return out;
}

/** One text level for a background, readable on it and on the given panels. */
export function inkFor(background: string, level: InkLevel, panels: readonly string[] = []): string {
	const dark = wantsDarkText(background);
	const spec = LEVELS[level];
	const bg = toOklch(background);
	const tinted = fromOklch({ l: toOklch(dark ? spec.onLight : spec.onDark).l, c: Math.min(TINT, bg.c), h: bg.h });
	return reach(tinted, [background, ...panels], spec.min, dark);
}

/** A chosen accent color (bold, italic) made readable on the background:
 *  unchanged when it already is, else lighter or darker with the same hue. */
export function readableAccent(color: string, background: string): string {
	return reach(color, [background], LEVELS.muted.min, wantsDarkText(background));
}
