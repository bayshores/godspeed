/** The block letters a decoding title scrambles through. */
const NOISE = "░▒▓█";

/**
 * A title partway through decoding: the first `progress` share of its
 * letters settled, the rest block letters (spaces stay spaces). `seed`
 * picks the noise, so each frame looks different.
 */
export function decodeFrame(text: string, progress: number, seed: number): string {
	const settled = Math.floor(Math.max(0, Math.min(1, progress)) * text.length);
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		out += i < settled || ch === " " ? ch : NOISE[(i * 7 + seed * 13) % NOISE.length];
	}
	return out;
}
