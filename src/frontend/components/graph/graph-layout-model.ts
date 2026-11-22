/**
 * Where the Graph's open panel goes in the page's room: a slip under the
 * picture, or, in a room too small for both, alone in the picture's place.
 * Pure, unit-tested.
 */

/** With less room than this, across or down, the panel takes the picture's place. */
const NARROW = 760;
const LOW = 470;
/** The share of the room's height the slip's links fold to fit under. */
const SLIP_SHARE = 0.45;
/** The topic's tab stands this far above the slip's top edge. */
export const TAB_H = 36;
/** The room between the picture's foot and the tab. */
const UNDER_PICTURE = 12;
/** The least height the picture keeps, enough for a topic and its name. */
const LEAST = 180;

export function panelAlone(room: { width: number; height: number }): boolean {
	return room.width < NARROW || room.height < LOW;
}

/** In a narrow room the panel is one column: the moon beside the name, the keys under the words. */
export function panelStacked(room: { width: number }): boolean {
	return room.width < NARROW;
}

/** The height the slip's links fold to fit under in a room this tall. */
export function slipCap(roomHeight: number): number {
	return Math.round(roomHeight * SLIP_SHARE);
}

/** The slip's greatest height: with every link folded, a fact's name and words may grow it to this, and the picture keeps its least height. */
export function slipMost(roomHeight: number): number {
	return roomHeight - TAB_H - UNDER_PICTURE - LEAST;
}

/** The picture's height over a slip this tall (0: no slip). */
export function pictureHeight(roomHeight: number, slip: number): number {
	return Math.max(LEAST, roomHeight - (slip > 0 ? slip + TAB_H + UNDER_PICTURE : 0));
}
