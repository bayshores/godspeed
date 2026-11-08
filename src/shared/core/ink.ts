/**
 * Text and edge colors that read well on any dark background. Each level
 * starts from the default gray, takes a hint of the background's hue (in
 * OKLCH, so the tint looks even across colors), then moves lighter until
 * it meets its contrast minimum. The app is dark only, so a picked color
 * is first made dark enough (darkBackground). Browser-safe, pure.
 */

export type InkLevel = "text" | "body" | "muted" | "faint" | "edge";

/** Each level's contrast minimum (WCAG ratio) and its default gray. Every
 *  text level is at least 4.5 (small text); an edge (field borders, empty
 *  bars) needs 3. */
const LEVELS: Record<InkLevel, { min: number; gray: string }> = {
	text: { min: 7, gray: "#e6e6e6" },
	body: { min: 6, gray: "#cfcfcf" },
	muted: { min: 4.5, gray: "#8d8d8d" },
	faint: { min: 4.5, gray: "#7a7a7a" },
	edge: { min: 3, gray: "#5a5a5a" },
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

/** The lightest a background may be (OKLCH lightness): darker than this
 *  stays easy on the eyes. */
const MAX_BACKGROUND_L = 0.3;

/** A picked color made dark enough for the app: its lightness capped (hue
 *  kept), then stepped darker until secondary text reads on it and on the
 *  surfaces it implies (`surfaces`, from the same background). */
export function darkBackground(color: string, surfaces: (background: string) => readonly string[]): string {
	const start = toOklch(color);
	let background = start.l > MAX_BACKGROUND_L ? fromOklch({ ...start, l: MAX_BACKGROUND_L, c: start.c * (MAX_BACKGROUND_L / start.l) }) : color;
	while (!inkReaches(background, "muted", surfaces(background))) background = shiftHex(background, -4);
	return background;
}

/** The accent: a pale tint of the background's hue (gray when it has
 *  none), readable as text on the background. */
export function tintFor(background: string): string {
	const bg = toOklch(background);
	const tinted = bg.c < 0.01 ? fromOklch({ l: 0.9, c: 0, h: 0 }) : fromOklch({ l: 0.82, c: 0.08, h: bg.h });
	return reach(tinted, [background], LEVELS.text.min);
}

/** `color` moved lighter in small steps, keeping its hue, until it has
 *  `min` contrast on every surface. Stops at white. */
function reach(color: string, surfaces: readonly string[], min: number): string {
	const start = toOklch(color);
	let out = color;
	for (let l = start.l; !surfaces.every((s) => contrast(out, s) >= min); ) {
		l += 0.01;
		if (l >= 1) return "#ffffff";
		// The tint fades as the color nears white, so it stays in gamut.
		out = fromOklch({ l, c: start.c * Math.min(1, (1 - l) / (1 - start.l)), h: start.h });
	}
	return out;
}

/** One ink level for a background, readable on it and on the given panels. */
export function inkFor(background: string, level: InkLevel, panels: readonly string[] = []): string {
	const spec = LEVELS[level];
	const bg = toOklch(background);
	const tinted = fromOklch({ l: toOklch(spec.gray).l, c: Math.min(TINT, bg.c), h: bg.h });
	return reach(tinted, [background, ...panels], spec.min);
}

/** True when this level can meet its minimum on the background and every panel. */
export function inkReaches(background: string, level: InkLevel, panels: readonly string[] = []): boolean {
	const ink = inkFor(background, level, panels);
	return [background, ...panels].every((s) => contrast(ink, s) >= LEVELS[level].min);
}

/** A color used as text or a mark (bold, italic, right, wrong, the ramps)
 *  made readable on the background and its panels: unchanged when it
 *  already is, else lighter with the same hue. */
export function readableAccent(color: string, background: string, panels: readonly string[] = []): string {
	return reach(color, [background, ...panels], LEVELS.muted.min);
}
