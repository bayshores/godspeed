/** How many samples at the loop's start are blended with what would have followed its end. */
const BLEND = 2048;

/**
 * Brown noise that loops without a click: `length` samples within -1..1.
 * White noise from `random` (0..1) is summed with a leak, so the low end
 * carries it. The samples that would follow the end are faded into the
 * start, so the last sample runs on into the first.
 */
export function brownNoise(length: number, random: () => number): Float32Array {
	const blend = Math.min(BLEND, Math.floor(length / 2));
	const out = new Float32Array(length);
	let last = 0;
	const next = () => {
		last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
		return Math.max(-1, Math.min(1, last * 3.5));
	};
	for (let i = 0; i < length; i++) out[i] = next();
	// The first `blend` samples, each blended with the one that would have followed the end.
	return out.map((sample, i) => (i < blend ? sample * (i / blend) + next() * (1 - i / blend) : sample));
}
