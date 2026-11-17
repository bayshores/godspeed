/**
 * How big the Graph picture is drawn: the page never scrolls, so a picture
 * taller than its box scales down evenly to fit, never up. Pure.
 */

/** The size topic names are laid out at. */
export const NAME_PX = 13;
/** Names drawn smaller than this are not drawn at rest. */
const MIN_NAME_PX = 11;
/** Halvings in the search for the largest scale. */
const STEPS = 7;

/**
 * The largest scale at most 1 at which a picture fits the box, with the
 * picture laid out at the width it covers once scaled (box width / scale),
 * so a shrunk picture still fills the box's width. `lay` lays the picture
 * out at a width.
 */
export function fitPicture<T extends { width: number; height: number }>(lay: (width: number) => T, box: { width: number; height: number }): { sky: T; scale: number } {
	let sky = lay(box.width);
	let scale = Math.min(1, box.height / sky.height);
	if (scale === 1) return { sky, scale };
	let lo = scale;
	let hi = 1;
	for (let i = 0; i < STEPS; i++) {
		const mid = (lo + hi) / 2;
		const wide = lay(Math.floor(box.width / mid));
		const fit = Math.min(mid, box.height / wide.height, box.width / wide.width);
		if (fit >= scale) [sky, scale] = [wide, fit];
		if (wide.height * mid <= box.height) lo = mid;
		else hi = mid;
	}
	return { sky, scale };
}

/** Too small to read: names wait until their topic is pointed at, picked, lit or found. */
export function namesHidden(scale: number): boolean {
	return NAME_PX * scale < MIN_NAME_PX;
}
