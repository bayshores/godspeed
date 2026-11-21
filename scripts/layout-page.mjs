/**
 * layout-page.mjs — the layout check that runs inside the app's window. layout.mjs sends this
 * file through the screens channel's `eval` with `export` taken out and calls checkPage(), which
 * answers a list of findings `{ check, what }`. The rect helpers are exported for the tests.
 *
 * - overlap: two elements that draw their own text, or are buttons, inputs or images, cross.
 * - covered: another box of the page, one that draws something, lies over part of such an
 *   element (a tag that hangs into a page whose cards scroll over it).
 * - spill: an element sticks out of its parent's box, up or down, while the parent neither
 *   scrolls nor clips.
 * - sideways: the page, or a panel at least half the window tall, scrolls sideways.
 * - hidden: text or a control lies outside a box that clips it without scrolling, such as a
 *   button pushed out of the bottom of an overflow-hidden card, before the start of a box
 *   that scrolls, where no scrolling reaches (a pop-up wider than the page it hangs in), or
 *   outside the window in a fixed box as the screen opens (a menu that opens past the window's
 *   edge).
 * - cut-off letters: a box that clips (truncate, line-clamp, overflow-hidden) cuts off the top or
 *   bottom of letters it shows, such as the tail of a "g".
 * - turn foot: beside the lesson text, the foot of "Your turn" (the Stuck? keys and the way out)
 *   reaches past the lesson's window, so the learner would scroll to answer.
 * - spacing: a page leaves the shared spacing (globals.css :root): a card (.lh-card) whose sides
 *   or bottom are not the inset, a reading surface (.lh-reading, the lesson text and "Your
 *   turn") whose sides are not the reading inset or its narrow step, two sheets in one page
 *   column side by side or one above the other at a gap that is not the shared one, or a page
 *   title not in the shared title class.
 * - bar key: a key (.lh-btn) in the app's top bar or a page's own bar, where words are flat
 *   like the tabs.
 * - empty box: a sheet or well (.lh-sheet, .lh-well) at least 160 px wide and 120 px tall that
 *   shows no words, picture, control or writing box: a column with nothing in it.
 * - hollow box: a sheet (.lh-sheet) at least that size has an empty band between two things it
 *   draws, taller than 160 px and than 35% of the sheet: a title at the top, keys at the foot
 *   and nothing between. A sheet that is allowed to stretch past what it holds carries
 *   `data-fills="<why>"`, and only such a sheet is let through.
 * - empty room: a page (.lh-page) in a box that scrolls is taller than what it holds, so the
 *   window scrolls into empty page under its last sheet (a height kept from another window size).
 * - cut start: the question or problem in "Your turn" (.lh-turn-scroll) is scrolled past its
 *   first line, though the walk did not scroll that box: it opened cut. A problem drawn as its
 *   page rests on the part the learner is on (data-part-current), so that box is let through
 *   while the part's start is in it.
 * - broken picture: an image the page shows did not load (a file the server does not hand out
 *   as a picture, or a wrong address).
 *
 * Each finding has a `key` naming its elements, the same from one read to the next while its
 * words (a clock) may change.
 *
 * The opening watch is the other half: watchOpening() is started before the walk opens a page
 * in the app (not a full load), with motion on, and openingFindings() reads it once it is done.
 * From the new page's first paint, the first frame that shows a sheet that was not there before
 * (for a page with no sheet, the frame its travel in ends), it watches for 1.5 s:
 *
 * - moved after opening: a sheet or a word or key of a bar that was there at the first paint
 *   moves, changes size or leaves; a sheet arrives later; the screen's scroller scrolls. Boxes
 *   are measured by layout, so the page's own travel into the window does not count.
 * - arrival motion: an animation or transition plays on something that was there at the first
 *   paint, or inside it. The moves the motion rule asks for are let through (openingAllowed).
 */

/** Pixels two boxes may cross, or a box may stick out, before it counts: rounding and
 *  antialiasing. */
const SLACK = 2;

/** The part two rects share, or null. */
export function meet(a, b) {
	const left = Math.max(a.left, b.left);
	const top = Math.max(a.top, b.top);
	const right = Math.min(a.right, b.right);
	const bottom = Math.min(a.bottom, b.bottom);
	return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** Whether two rects cross by more than SLACK both ways. */
export function cross(a, b) {
	const shared = meet(a, b);
	return !!shared && shared.right - shared.left > SLACK && shared.bottom - shared.top > SLACK;
}

/** Whether `child` sticks out of `parent` above or below by more than SLACK. */
export function sticksOut(child, parent) {
	return child.bottom > parent.bottom + SLACK || child.top < parent.top - SLACK;
}

/** Where a run of text's letters reach, up and down. A text box is as tall as the font's ascent
 *  and descent, so the baseline sits the font's ascent below its top; the letters' ink reaches
 *  their own ascent above it and descent below it (canvas measureText metrics). */
export function inkOf(box, metrics) {
	const baseline = box.top + metrics.fontBoundingBoxAscent;
	return { top: baseline - metrics.actualBoundingBoxAscent, bottom: baseline + metrics.actualBoundingBoxDescent };
}

/** Whether `box` reaches more than SLACK outside `clip` along the axes it clips. */
export function outside(box, clip) {
	return (clip.x && (box.left < clip.left - SLACK || box.right > clip.right + SLACK)) || (clip.y && (box.top < clip.top - SLACK || box.bottom > clip.bottom + SLACK));
}

/** What a scroller hides for good, as a clip box. Along an axis it scrolls only what lies before
 *  its start is lost (the rest is scrolled to), so that side has no end; along an axis it only
 *  clips, both sides are. `inner` is its padding box, `scrolled` how far it is scrolled now. */
export function scrollerClip(inner, scrolled, scrolls) {
	return {
		x: true,
		y: true,
		left: scrolls.x ? inner.left - scrolled.left : inner.left,
		top: scrolls.y ? inner.top - scrolled.top : inner.top,
		right: scrolls.x ? Infinity : inner.right,
		bottom: scrolls.y ? Infinity : inner.bottom,
	};
}

/** Whole pixels of ink cut off by a clip box at the top and the bottom; under 1 px is rounding. */
export function cutOf(ink, clip) {
	const cut = (px) => (px >= 1 ? Math.round(px) : 0);
	return { top: cut(clip.top - ink.top), bottom: cut(ink.bottom - clip.bottom) };
}

const clips = (style) => style.overflowX !== "visible" || style.overflowY !== "visible";
const CONTROLS = "button, input, select, textarea";
const PICTURES = "img, svg, canvas, video, .katex, .xterm";
/** One picture drawn by many boxes, which are not checked against each other. */
const ONE_PICTURE = ".katex, .xterm, [data-picture]";

/** A number per element, kept on the window, so a finding is matched by its elements across
 *  reads. */
function idOf(el) {
	window.__layoutIds ??= new WeakMap();
	if (!window.__layoutIds.has(el)) window.__layoutIds.set(el, (window.__layoutNext = (window.__layoutNext ?? 0) + 1));
	return window.__layoutIds.get(el);
}

const finding = (check, els, what) => ({ check, key: `${check} ${els.map(idOf).join(" ")}`, what });

/** How a finding names an element: its test id (or the nearest one above it) and first words. */
function label(el) {
	const owner = el.closest("[data-testid]");
	const words = (el.getAttribute("aria-label") || el.getAttribute("alt") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
	const id = owner ? (owner === el ? owner.dataset.testid : `${owner.dataset.testid} > ${el.localName}`) : el.localName;
	return words ? `${id} "${words}"` : id;
}

/** `rect` cut down by everything that clips `el`: the window, a `clip` or `clip-path` on it or
 *  above it (text only for screen readers), and each scrolling or clipping ancestor that is part
 *  of its containing-block chain (a fixed box escapes them all, an absolute one those below its
 *  positioned ancestor). */
function visiblePart(el, rect) {
	let part = meet(rect, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
	for (let node = el; node && part; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (style.clip !== "auto" || style.clipPath !== "none") part = meet(part, node.getBoundingClientRect());
	}
	// Its own overflow clips its own text (truncate).
	if (part && clips(getComputedStyle(el))) part = meet(part, el.getBoundingClientRect());
	let position = getComputedStyle(el).position;
	let skipTo = position === "absolute" ? el.offsetParent : null;
	for (let node = el.parentElement; node && part && position !== "fixed"; node = node.parentElement) {
		if (skipTo && node !== skipTo) continue;
		skipTo = null;
		const style = getComputedStyle(node);
		if (clips(style)) part = meet(part, node.getBoundingClientRect());
		position = style.position;
		if (position === "absolute") skipTo = node.offsetParent;
	}
	return part;
}

/** A line of text's box cut to its line height around its middle. A text box is as tall as the
 *  font's ascent and descent; tight leading (a big heading over its subtitle) lets those cross
 *  while the letters do not, so only the line box CSS lays out counts. */
export function lineBox(box, lineHeight) {
	if (!(lineHeight < box.bottom - box.top)) return box;
	const middle = (box.top + box.bottom) / 2;
	return { left: box.left, right: box.right, top: middle - lineHeight / 2, bottom: middle + lineHeight / 2 };
}

/** The boxes `el` draws as its own: one per line of its own text, or its border box for a
 *  control or picture. */
function ownBoxes(el) {
	if (el.matches(`${CONTROLS}, ${PICTURES}`)) return [el.getBoundingClientRect()];
	const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
	const boxes = [];
	for (const node of el.childNodes) {
		if (node.nodeType !== Node.TEXT_NODE || !node.data.trim()) continue;
		const range = document.createRange();
		range.selectNodeContents(node);
		boxes.push(...[...range.getClientRects()].map((box) => lineBox(box, lineHeight)));
	}
	return boxes;
}

const OVERLAYS = "[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [role=tooltip], [popover]";

/** A box that draws on its own layer over the page: a fixed or sticky bar, or a true overlay (a
 *  dialog, a menu, a tooltip). A positioned box in the page's flow stays in the page's layer, z-index
 *  or not, so text it draws over other text is an overlap. */
function layerOf(el) {
	for (let node = el; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (style.position === "fixed" || style.position === "sticky" || node.matches(OVERLAYS)) return node;
	}
	return document.documentElement;
}

const shown = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });

/**
 * Overlap. Deliberate layers (layerOf) are never compared with each other: a tooltip, a fixed
 * bar or a dialog over the page is not an overlap. What another layer covers at the middle of
 * its visible part (elementFromPoint), such as the page under a dialog's dim, drops out, and so
 * does what a scroller clips away. Two boxes in one layer that cross count: that is text drawn
 * on text, whichever of them the browser happens to hit first.
 */
function overlaps() {
	const items = [];
	for (const el of document.body.querySelectorAll("*")) {
		// Math is drawn by KaTeX, SVG by its own geometry, and the agent's screen (xterm) and a
		// page drawn sharper where it is zoomed (data-picture) on stacked canvases: each is one picture. What the app marks aria-hidden is decoration (a
		// backdrop, an icon in a button), not content.
		if (
			(el.closest(ONE_PICTURE) && !el.matches(ONE_PICTURE)) ||
			(el.closest("svg") && el.localName !== "svg") ||
			el.closest("[aria-hidden=true]") ||
			!shown(el)
		)
			continue;
		const boxes = ownBoxes(el)
			.map((box) => visiblePart(el, box))
			.filter((box) => box && box.right - box.left > SLACK && box.bottom - box.top > SLACK);
		if (boxes.length === 0) continue;
		const [first] = boxes;
		const hit = document.elementFromPoint((first.left + first.right) / 2, (first.top + first.bottom) / 2);
		const layer = layerOf(el);
		if (!hit || layerOf(hit) !== layer) continue;
		items.push({ el, boxes, layer, top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) });
	}
	items.sort((a, b) => a.top - b.top);
	const found = [];
	for (let i = 0; i < items.length; i++) {
		const a = items[i];
		for (let j = i + 1; j < items.length && items[j].top < a.bottom; j++) {
			const b = items[j];
			if (a.layer !== b.layer || a.el.contains(b.el) || b.el.contains(a.el)) continue;
			if (a.boxes.some((x) => b.boxes.some((y) => cross(x, y)))) found.push(finding("overlap", [a.el, b.el], `${label(a.el)} and ${label(b.el)}`));
		}
	}
	return found;
}

/**
 * Spill: an in-flow block box whose parent neither scrolls nor clips, sticking out of that
 * parent up or down (what a clipping parent cuts away is the hidden check's). Out-of-flow boxes
 * (absolute, fixed) are placed on purpose, and inline boxes follow the line, so neither is
 * measured.
 */
function spills() {
	const found = [];
	for (const el of document.body.querySelectorAll("*")) {
		if (el.closest("svg, .katex") || !shown(el)) continue;
		const style = getComputedStyle(el);
		if (style.display.startsWith("inline") || style.display === "contents" || style.position === "absolute" || style.position === "fixed") continue;
		let parent = el.parentElement;
		while (parent && getComputedStyle(parent).display === "contents") parent = parent.parentElement;
		if (!parent || parent === document.documentElement || clips(getComputedStyle(parent))) continue;
		const box = el.getBoundingClientRect();
		if (box.height === 0) continue;
		if (sticksOut(box, parent.getBoundingClientRect())) found.push(finding("spill", [el, parent], `${label(el)} sticks out of ${label(parent)}`));
	}
	return found;
}

/** Sideways scrolling: the page, or a scrolling panel at least half the window tall (smaller
 *  scrollers such as code blocks and tab strips scroll sideways on purpose). */
function sideways() {
	const found = [];
	const page = document.scrollingElement;
	if (page.scrollWidth > page.clientWidth + 1) found.push(finding("sideways", [page], `the page is ${page.scrollWidth} wide in ${page.clientWidth}`));
	for (const el of document.body.querySelectorAll("*")) {
		const style = getComputedStyle(el);
		if (!["auto", "scroll"].includes(style.overflowX) || el.clientHeight < innerHeight / 2 || !shown(el)) continue;
		if (el.scrollWidth > el.clientWidth + 1) found.push(finding("sideways", [el], `${label(el)} is ${el.scrollWidth} wide in ${el.clientWidth}`));
	}
	return found;
}

const SCROLLS = ["auto", "scroll"];
const CLIPS = ["hidden", "clip"];

/** The boxes that hide part of `el` for good, nearest first: its own, then those of the
 *  ancestors in its containing-block chain, and last the window. A scroller hides only what
 *  scrollerClip says, and carries its `inner` box: what it shows is all that the boxes after it
 *  can hide. A fixed box escapes the ancestors and ends at the window, which nothing scrolls.
 *  Each says which axes it clips. */
function clipBoxes(el) {
	const found = [];
	let position = null;
	let skipTo = null;
	for (let node = el; node && node !== document.body && position !== "fixed"; node = node.parentElement) {
		if (skipTo && node !== skipTo) continue;
		skipTo = null;
		const style = getComputedStyle(node);
		const scrolls = { x: SCROLLS.includes(style.overflowX), y: SCROLLS.includes(style.overflowY) };
		const x = CLIPS.includes(style.overflowX);
		const y = CLIPS.includes(style.overflowY);
		// Overflow does nothing on an inline box.
		if ((x || y || scrolls.x || scrolls.y) && style.display !== "inline") {
			const box = node.getBoundingClientRect();
			const left = box.left + node.clientLeft;
			const top = box.top + node.clientTop;
			const inner = { left, top, right: left + node.clientWidth, bottom: top + node.clientHeight };
			if (scrolls.x || scrolls.y) found.push({ node, style, inner, ...scrollerClip(inner, { left: node.scrollLeft, top: node.scrollTop }, scrolls) });
			else found.push({ node, style, x, y, ...inner });
		}
		position = style.position;
		if (position === "absolute") skipTo = node.offsetParent;
	}
	const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
	const page = position === "fixed" ? { fixed: true, x: true, y: true, ...view } : scrollerClip(view, { left: scrollX, top: scrollY }, { x: true, y: true });
	found.push({ node: document.documentElement, style: getComputedStyle(document.documentElement), window: true, inner: view, ...page });
	return found;
}

/**
 * Hidden: text or a control that lies outside a box that clips it. What is cut away on purpose
 * does not count: the tail truncate replaces with "..." (text-overflow), the lines line-clamp
 * drops, and everything in a box collapsed to nothing (a closed panel, text for screen readers
 * only). A picture cropped by its frame is not measured.
 */
function hiddens() {
	const found = [];
	// A menu follows its button, so once the screen is scrolled it may leave the window with it.
	const scrolled = (mainScroller()?.scrollTop ?? 0) > 0;
	for (const el of document.body.querySelectorAll("*")) {
		if (el.closest("svg, .katex, [aria-hidden=true]") || el.matches(PICTURES) || !shown(el)) continue;
		const control = el.matches(CONTROLS);
		let boxes = ownBoxes(el);
		for (const clip of clipBoxes(el)) {
			if (boxes.length === 0 || clip.right - clip.left <= SLACK || clip.bottom - clip.top <= SLACK) break;
			// What the learner pans (data-pans) is reached by panning, as a scroller's is by scrolling.
			if (clip.node.hasAttribute("data-pans")) break;
			// A control's own overflow clips its label, not the control.
			if ((control && clip.node === el) || (clip.fixed && scrolled)) continue;
			const axes = { ...clip, x: clip.x && clip.style.textOverflow !== "ellipsis", y: clip.y && !(Number(clip.style.webkitLineClamp) > 0) };
			if (boxes.some((box) => outside(box, axes))) {
				found.push(finding("hidden", [el, clip.node], `${label(el)} lies outside ${clip.window ? "the window" : clip.node === el ? "its own box" : label(clip.node)}`));
				break;
			}
			if (clip.inner) boxes = boxes.map((box) => meet(box, clip.inner)).filter(Boolean);
		}
	}
	return found;
}

/**
 * Cut-off letters. For each line of text a box clips, the letters' ink (inkOf) must stay inside
 * it. Only lines whose middle the box shows are measured; the others are the hidden check's. A
 * line that may be cut is measured again letter by letter, to name the letter.
 */
function cutOffs() {
	const found = [];
	const context = document.createElement("canvas").getContext("2d");
	const measure = (style, text) => {
		context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		return context.measureText(text);
	};
	const shows = (clip, box) => {
		const middle = (box.top + box.bottom) / 2;
		return middle > clip.top && middle < clip.bottom && box.right > clip.left && box.left < clip.right;
	};
	for (const el of document.body.querySelectorAll("*")) {
		const texts = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.data.trim());
		// Text for screen readers only is clipped to nothing on purpose.
		if (texts.length === 0 || el.closest("svg, .katex") || !shown(el) || !visiblePart(el, el.getBoundingClientRect())) continue;
		// Up to the first scroller: under its edge a line is scrolled, not cut.
		const boxes = clipBoxes(el);
		const clipping = boxes.slice(0, boxes.findIndex((clip) => clip.inner)).filter((clip) => clip.y);
		if (clipping.length === 0) continue;
		const style = getComputedStyle(el);
		const range = document.createRange();
		let worst = null;
		for (const node of texts) {
			range.selectNodeContents(node);
			const lines = [...range.getClientRects()];
			const whole = measure(style, node.data);
			for (const clip of clipping) {
				for (const line of lines.filter((box) => shows(clip, box))) {
					const cut = cutOf(inkOf(line, whole), clip);
					if (!cut.top && !cut.bottom) continue;
					for (let i = 0; i < node.data.length; i++) {
						if (!node.data[i].trim()) continue;
						range.setStart(node, i);
						range.setEnd(node, i + 1);
						const box = range.getBoundingClientRect();
						if (!shows(clip, box) || box.top >= line.bottom || box.bottom <= line.top) continue;
						const letter = cutOf(inkOf(box, measure(style, node.data[i])), clip);
						const px = Math.max(letter.top, letter.bottom);
						if (px > (worst?.px ?? 0)) worst = { px, letter: node.data[i], side: letter.bottom >= letter.top ? "bottom" : "top", clip: clip.node };
					}
				}
			}
		}
		if (worst) found.push(finding("cut-off letters", [el], `${label(el)}: the "${worst.letter}" loses ${worst.px} px at the ${worst.side}, clipped by ${worst.clip === el ? "its own box" : label(worst.clip)}`));
	}
	return found;
}

/** Points inside a box to test for cover: three rows (a quarter, half and three quarters down)
 *  of three (near the left, the middle, near the right), kept SLACK + 1 pixels in from the edges
 *  so a neighbour's antialiasing never counts. */
export function probes(box) {
	const inset = SLACK + 1;
	const xs = [box.left + inset, (box.left + box.right) / 2, box.right - inset];
	const ys = [0.25, 0.5, 0.75].map((f) => box.top + (box.bottom - box.top) * f);
	return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

const transparent = (color) => color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);

/** Whether a box draws something of its own over its whole area: a fill, a background picture,
 *  or a picture. An empty box laid over text covers nothing, such as a row's button whose click
 *  area stretches over the row. */
function paints(el) {
	const style = getComputedStyle(el);
	return !transparent(style.backgroundColor) || style.backgroundImage !== "none" || el.matches(PICTURES);
}

/**
 * Covered: text or a control with another box of the same layer drawn over part of it, such as a
 * tag that hangs into a page whose cards scroll over it. Deliberate layers (a dialog, a menu, a
 * fixed or sticky bar) are never compared with the page. A box over the text counts only when it,
 * or a box around it that is not also around the text, draws something.
 */
function covereds() {
	const found = [];
	for (const el of document.body.querySelectorAll("*")) {
		if ((el.closest(ONE_PICTURE) && !el.matches(ONE_PICTURE)) || (el.closest("svg") && el.localName !== "svg") || el.closest("[aria-hidden=true]") || !shown(el)) continue;
		const layer = layerOf(el);
		let over = null;
		for (const own of ownBoxes(el)) {
			const part = visiblePart(el, own);
			if (!part || part.right - part.left <= 2 * SLACK + 2 || part.bottom - part.top <= SLACK) continue;
			for (const { x, y } of probes(part)) {
				const hit = document.elementFromPoint(x, y);
				if (!hit || hit === el || el.contains(hit) || hit.contains(el) || !shown(hit) || layerOf(hit) !== layer) continue;
				for (let node = hit; node && !node.contains(el); node = node.parentElement) {
					if (paints(node)) {
						over = node;
						break;
					}
				}
				if (over) break;
			}
			if (over) break;
		}
		if (over) found.push(finding("covered", [el, over], `${label(el)} is under ${label(over)}`));
	}
	return found;
}

/** The screen's scroller: the tallest box that scrolls up and down, or the page itself. */
function mainScroller() {
	let best = null;
	for (const el of document.body.querySelectorAll("*")) {
		const style = getComputedStyle(el);
		if (!SCROLLS.includes(style.overflowY) || el.scrollHeight <= el.clientHeight + 1 || !shown(el)) continue;
		if (!best || el.clientHeight > best.clientHeight) best = el;
	}
	const page = document.scrollingElement;
	return best ?? (page.scrollHeight > page.clientHeight + 1 ? page : null);
}

/** Scrolls the screen's scroller to `top` pixels, or to its end for "end"; 0 goes back. Answers
 *  whether it moved, so a screen that can't scroll that far is not checked twice. */
export function scrollMain(top) {
	const el = mainScroller();
	if (!el) return false;
	const before = el.scrollTop;
	el.scrollTop = top === "end" ? el.scrollHeight : top;
	// Cut start leaves out the box the walk itself scrolled.
	window.__layoutScrolled = top === 0 ? null : el;
	return el.scrollTop !== before;
}

/** Whether the space between two neighbouring sheets breaks the shared gap: it is not the gap
 *  (give or take rounding) and is under twice the gap, as wider space means the two are not
 *  neighbours but sit in columns that end at different heights. */
export function offGap(space, gap) {
	return space < 2 * gap && Math.abs(space - gap) > 1;
}

/** A box that floats over the page (a pop-up, a pane on the Graph picture), up to the page's
 *  column. */
function floats(el) {
	for (let node = el; node && !node.classList.contains("lh-page"); node = node.parentElement) {
		if (["absolute", "fixed"].includes(getComputedStyle(node).position)) return true;
	}
	return false;
}

/** Whether a box's sides match none of the allowed insets; all sides must match the same one. */
export function offInset(sides, insets) {
	return !insets.some((inset) => sides.every((side) => Math.abs(side - inset) <= 0.5));
}

function spacings() {
	const found = [];
	const root = getComputedStyle(document.documentElement);
	const inset = parseFloat(root.getPropertyValue("--lh-inset"));
	const gap = parseFloat(root.getPropertyValue("--lh-gap"));
	for (const card of document.querySelectorAll(".lh-page .lh-card")) {
		if (!shown(card)) continue;
		const style = getComputedStyle(card);
		const sides = { left: style.paddingLeft, right: style.paddingRight, bottom: style.paddingBottom };
		const off = Object.entries(sides).filter(([, side]) => offInset([parseFloat(side)], [inset]));
		if (off.length > 0) found.push(finding("spacing", [card], `${label(card)} is a card inset ${off.map(([name, side]) => `${side} on the ${name}`).join(", ")}; every card is inset ${inset}px (--lh-inset)`));
	}
	const reading = ["--lh-reading-inset", "--lh-reading-inset-narrow"].map((name) => parseFloat(root.getPropertyValue(name)));
	for (const surface of document.querySelectorAll(".lh-page .lh-reading")) {
		if (!shown(surface)) continue;
		const style = getComputedStyle(surface);
		const sides = [style.paddingLeft, style.paddingRight].map(parseFloat);
		if (offInset(sides, reading)) found.push(finding("spacing", [surface], `${label(surface)} is a reading surface inset ${sides[0]}px on the left, ${sides[1]}px on the right; every reading surface is inset ${reading[0]}px (--lh-reading-inset), or ${reading[1]}px in a narrow column (--lh-reading-inset-narrow)`));
	}
	const sheets = [...document.querySelectorAll(".lh-page .lh-sheet")].filter((el) => shown(el) && !el.parentElement.closest(".lh-sheet, [role=dialog], [role=menu]") && !floats(el));
	for (const a of sheets) {
		const ab = a.getBoundingClientRect();
		let right = null;
		let below = null;
		for (const b of sheets) {
			// Only sheets in one column: a pinned bar (the lesson's step line) has the page scroll under it.
			if (a === b || a.closest(".lh-page") !== b.closest(".lh-page")) continue;
			const bb = b.getBoundingClientRect();
			if (Math.min(ab.bottom, bb.bottom) - Math.max(ab.top, bb.top) > 4 && bb.left >= ab.right - 1 && (!right || bb.left < right.box.left)) right = { el: b, box: bb };
			if (Math.min(ab.right, bb.right) - Math.max(ab.left, bb.left) > 4 && bb.top >= ab.bottom - 1 && (!below || bb.top < below.box.top)) below = { el: b, box: bb };
		}
		const apart = (b, space, way) => `${label(a)} and ${label(b)} are ${Math.round(space)}px apart ${way}; neighbouring cards are ${gap}px apart (--lh-gap)`;
		if (right && offGap(right.box.left - ab.right, gap)) found.push(finding("spacing", [a, right.el], apart(right.el, right.box.left - ab.right, "side by side")));
		if (below && offGap(below.box.top - ab.bottom, gap)) found.push(finding("spacing", [a, below.el], apart(below.el, below.box.top - ab.bottom, "one above the other")));
	}
	// A heading in rendered Markdown (.lh-prose) is its writer's, not the page's title.
	for (const title of document.querySelectorAll(".lh-page h1")) {
		if (shown(title) && !title.closest(".sr-only, .lh-prose") && !title.classList.contains("sr-only") && !title.classList.contains("lh-page-title")) found.push(finding("spacing", [title], `${label(title)} is a page's h1 without the .lh-page-title class, so it is not the shared title size`));
	}
	return found;
}

/** Turn foot: side by side with the lesson text, "Your turn" fits the lesson's window, its foot
 *  row included, at every scroll. */
function turnFoot() {
	const foot = document.querySelector("[data-testid=turn-foot]");
	const column = document.querySelector("[data-testid=lesson-column]");
	if (!foot || !column || getComputedStyle(column).display !== "grid" || !shown(foot)) return [];
	let view = { top: 0, bottom: innerHeight };
	for (let node = foot.parentElement; node; node = node.parentElement) {
		if (!SCROLLS.includes(getComputedStyle(node).overflowY)) continue;
		const box = node.getBoundingClientRect();
		view = { top: Math.max(0, box.top), bottom: Math.min(innerHeight, box.bottom) };
		break;
	}
	const box = foot.getBoundingClientRect();
	if (box.top >= view.top - SLACK && box.bottom <= view.bottom + SLACK) return [];
	return [finding("turn foot", [foot], `${label(foot)} spans ${Math.round(box.top)} to ${Math.round(box.bottom)} px, outside the lesson's window (${Math.round(view.top)} to ${Math.round(view.bottom)} px) beside the lesson text`)];
}

/** Bar key: a bar's words are flat like its tabs; a pop-up that hangs from the bar keeps its keys. */
function barKeys() {
	return [...document.querySelectorAll(":is(.lh-app-bar, .lh-own-bar) .lh-btn")]
		.filter((key) => shown(key) && !key.closest(".lh-popup, [role=dialog], [role=menu]"))
		.map((key) => finding("bar key", [key], `${label(key)} is a key in a bar`));
}

/** Empty box: a box is drawn for what it holds. A field or a chip is smaller than this. A box
 *  inside aria-hidden is a drawing (the paper on the lesson's desk), and the well around a
 *  drawing holds it. */
const BOX_MIN = { width: 160, height: 120 };
const HOLDS = `${CONTROLS}, ${PICTURES}, iframe, [contenteditable=true]`;
const DRAWING = `[aria-hidden=true] :is(.lh-sheet, ${PICTURES})`;
function emptyBoxes() {
	return [...document.querySelectorAll(".lh-sheet, .lh-well")]
		.filter((box) => {
			if (!shown(box) || box.matches(HOLDS) || box.closest("[aria-hidden=true]")) return false;
			const { width, height } = box.getBoundingClientRect();
			if (width < BOX_MIN.width || height < BOX_MIN.height) return false;
			return box.innerText.trim() === "" && ![...box.querySelectorAll(`${HOLDS}, ${DRAWING}`)].some(shown);
		})
		.map((box) => finding("empty box", [box], `${label(box)} is a box with nothing in it`));
}

/** The tallest stretch, top to bottom, that lies between two of `boxes` and that none of them
 *  crosses, with the box above it and the box below it; null when there is none. Room above
 *  the first box and under the last is not between two. */
export function emptyBand(boxes) {
	const sorted = [...boxes].sort((a, b) => a.top - b.top);
	let band = null;
	let above = sorted[0];
	for (const box of sorted.slice(1)) {
		const height = box.top - above.bottom;
		if (height > 0 && (!band || height > band.height)) band = { top: above.bottom, bottom: box.top, height, above, below: box };
		if (box.bottom > above.bottom) above = box;
	}
	return band;
}

/** A band is hollow past 160 px and past 35% of its sheet's height: a sheet that tall holds
 *  that much room between its things on purpose only when it says so (data-fills). */
const HOLLOW = { least: 160, share: 0.35 };
export function hollow(band, sheetHeight) {
	return band > Math.max(HOLLOW.least, HOLLOW.share * sheetHeight);
}

/** What a sheet draws as one box: a control, a picture (one drawn by many boxes too, such as a
 *  page of a PDF), a frame, an editor, a well or a sheet inside it. Anything else draws its own
 *  lines of text. */
const DRAWS_BOX = `${HOLDS}, ${ONE_PICTURE}, .lh-well, .lh-sheet`;

/** Hollow box: a sheet with a tall empty band between two things it draws, cut to what shows. */
function hollowBoxes() {
	const found = [];
	for (const sheet of document.querySelectorAll(".lh-sheet")) {
		if (!shown(sheet) || sheet.hasAttribute("data-fills") || sheet.closest("[aria-hidden=true]")) continue;
		const { width, height } = sheet.getBoundingClientRect();
		if (width < BOX_MIN.width || height < BOX_MIN.height) continue;
		const drawn = [];
		for (const el of sheet.querySelectorAll("*")) {
			if ((el.closest(ONE_PICTURE) && !el.matches(ONE_PICTURE)) || (el.closest("svg") && el.localName !== "svg") || !shown(el)) continue;
			for (const box of el.matches(DRAWS_BOX) ? [el.getBoundingClientRect()] : ownBoxes(el)) {
				const part = visiblePart(el, box);
				if (part && part.bottom > part.top && part.right > part.left) drawn.push({ ...part, el });
			}
		}
		const band = emptyBand(drawn);
		if (!band || !hollow(band.height, height)) continue;
		found.push(finding("hollow box", [sheet], `${label(sheet)} is ${Math.round(height)} px tall with an empty band of ${Math.round(band.height)} px (${Math.round((100 * band.height) / height)}%) between ${label(band.above.el)} and ${label(band.below.el)}`));
	}
	return found;
}

/** How much of a page's box lies under the last thing it holds, in whole pixels; rounding is none. */
export function roomUnder(pageEnd, lastEnd) {
	const room = Math.round(pageEnd - lastEnd);
	return room > SLACK ? room : 0;
}

/** Empty room: a page that scrolls ends with the last thing it holds. A page that fits its
 *  window may be taller than what it holds (a short page fills the window). */
function emptyRooms() {
	const found = [];
	for (const page of document.querySelectorAll(".lh-page")) {
		if (!shown(page)) continue;
		let scroller = page.parentElement;
		while (scroller && !SCROLLS.includes(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
		if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) continue;
		let last = null;
		let lastEnd = -Infinity;
		for (const child of page.children) {
			const style = getComputedStyle(child);
			if (!shown(child) || ["absolute", "fixed"].includes(style.position)) continue;
			const end = child.getBoundingClientRect().bottom + parseFloat(style.marginBottom);
			if (end > lastEnd) [last, lastEnd] = [child, end];
		}
		if (!last) continue;
		const style = getComputedStyle(page);
		const room = roomUnder(page.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth), lastEnd);
		if (room) found.push(finding("empty room", [page], `${label(last)} ends ${room}px above the end of its page, which the window scrolls into`));
	}
	return found;
}

/** Cut start: a box in "Your turn" found scrolled, when the walk did not scroll it, opened that way. */
/** Whether the box shows the start of the part the learner is on, where a problem's page rests. */
function restsOnPart(box) {
	const start = box.querySelector("[data-part-current]");
	if (!start) return false;
	const at = start.getBoundingClientRect().top;
	const room = box.getBoundingClientRect();
	return at >= room.top && at < room.bottom;
}

function cutStarts() {
	return [...document.querySelectorAll(".lh-turn-scroll")]
		.filter((box) => shown(box) && box.scrollTop > 1 && box !== window.__layoutScrolled && !restsOnPart(box))
		.map((box) => finding("cut start", [box], `${label(box)} is scrolled ${Math.round(box.scrollTop)}px past its first line`));
}

function brokenPictures() {
	// The writing box's editor spaces its lines with img elements that have no address.
	return [...document.querySelectorAll("img[src]")]
		.filter((img) => shown(img) && img.complete && img.naturalWidth === 0)
		.map((img) => finding("broken picture", [img], `${label(img)} did not load ${img.getAttribute("src")}`));
}

/** How long after the new page's first paint its opening is watched. */
const WATCH_MS = 1500;

/** What the opening watch follows: the sheets, and the words and keys of the bars. A drawing
 *  (aria-hidden) and the still copy of the page that leaves are not followed. */
function followed() {
	const sheets = [...document.querySelectorAll(".lh-sheet")].filter((el) => !el.closest("[aria-hidden=true], .lh-travel-old"));
	const words = (el) => [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.data.trim());
	const bar = [...document.querySelectorAll(":is(.lh-app-bar, .lh-own-bar) *")].filter((el) => !el.closest("[aria-hidden=true]") && (el.matches(`a, ${CONTROLS}`) || words(el)));
	return { sheets, bar };
}

/** An element's box as layout places it, so a transform (the page's travel) does not move it. */
function layoutBox(el) {
	let left = 0;
	let top = 0;
	for (let node = el; node; node = node.offsetParent) {
		left += node.offsetLeft;
		top += node.offsetTop;
	}
	return { left, top, width: el.offsetWidth, height: el.offsetHeight };
}

/** Whether a layout box moved or changed size by more than SLACK. */
export function boxMoved(a, b) {
	return ["left", "top", "width", "height"].some((side) => Math.abs(a[side] - b[side]) > SLACK);
}

/** The boxes at the first paint and in a later frame, by id (an id missing later has left the
 *  page): which moved or left, and which ids are new. */
export function movedSince(first, later) {
	const moved = Object.keys(first)
		.filter((id) => !later[id] || boxMoved(first[id], later[id]))
		.map((id) => ({ id, from: first[id], to: later[id] ?? null }));
	return { moved, arrived: Object.keys(later).filter((id) => !(id in first)) };
}

/** Whether a move ought to be left out because the box around it moved: it left with it, or it
 *  was carried the same way at the same size. `outer` and `inner` are moves from movedSince. */
export function carried(inner, outer) {
	if (!outer.to) return true;
	if (!inner.to || inner.from.width !== inner.to.width || inner.from.height !== inner.to.height) return false;
	const shift = (move, side) => move.to[side] - move.from[side];
	return Math.abs(shift(inner, "left") - shift(outer, "left")) <= SLACK && Math.abs(shift(inner, "top") - shift(outer, "top")) <= SLACK;
}

/** A page's own words in the top bar fade in with the page (globals.css). */
const BAR_WORDS = ".lh-bar-actions > *, .lh-bar-zoom, [data-testid=bar-crumb] > *";

/** The moves the motion rule (docs/ui-rules.md) asks for, so they are not arrival motion: the
 *  pages' travel (Travel), a page's own words fading into the top bar with it, and the mark of
 *  the lit tab sliding to the lit tab (useLitMarker). */
function openingAllowed(animation, target) {
	if (target.matches(".lh-travel-page, .lh-travel-old")) return true;
	if (animation.animationName === "lh-fade-in" && target.matches(BAR_WORDS)) return true;
	return animation.transitionProperty !== undefined && target.matches(".lh-lit-marker");
}

/** A box in words for a finding. */
const boxWords = (box) => `${Math.round(box.width)} by ${Math.round(box.height)} at ${Math.round(box.left)}, ${Math.round(box.top)}`;

/** Reads frames as they are drawn. `next()` asks for the coming frame; `read` then runs inside it,
 *  once it is laid out and the page's own ResizeObservers have run. A frame's own callback runs
 *  before that, and a task after the frame runs after whatever was waiting: both read a state that
 *  is never drawn, and what a ResizeObserver puts in its place would count as a move. `stop()`
 *  ends it. */
function drawnFrames(read) {
	// Deeper than anything of the page's, so the probe changes no round of the page's observers.
	const root = document.createElement("div");
	root.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
	let outer = root;
	for (let depth = 0; depth < 200; depth++) outer = outer.appendChild(document.createElement("div"));
	const inner = outer.appendChild(document.createElement("div"));
	let due = null;
	let flip = false;
	// The inner box changes size in the outer one's callback, so its own callback runs in a later
	// round of the same frame.
	const first = new ResizeObserver(() => (inner.style.height = flip ? "2px" : "1px"));
	const second = new ResizeObserver(() => {
		if (due === null) return;
		const now = due;
		due = null;
		read(now);
	});
	document.body.append(root);
	first.observe(outer);
	second.observe(inner);
	return {
		next() {
			requestAnimationFrame((now) => {
				due = now;
				flip = !flip;
				outer.style.height = flip ? "2px" : "1px";
			});
		},
		stop() {
			first.disconnect();
			second.disconnect();
			root.remove();
		},
	};
}

/** Starts the opening watch for a page about to open at `path`, in the page as it is before. What
 *  it follows that is in the page now is old; the new page's first paint is the first frame in
 *  which a shown sheet that is not old is there, or, for a page that traveled in with none, the
 *  first frame after its travel. The watch runs every frame from then for
 *  WATCH_MS, and keeps what it saw on the window for openingFindings. */
export function watchOpening(path) {
	const before = followed();
	const old = new WeakSet([...before.sheets, ...before.bar]);
	const watch = { firstAt: null, framesBefore: 0, done: false, els: {}, moves: {}, arrivals: {}, motions: {}, scrolls: new Map() };
	window.__layoutOpening = watch;
	const scrolled = new Set();
	const onScroll = (event) => scrolled.add(event.target === document ? document.scrollingElement : event.target);
	addEventListener("scroll", onScroll, { capture: true, passive: true });
	let first = null;
	let traveled = false;
	let atFirst = null;
	let scrollAt = null;
	const last = {};
	const frame = (now) => {
		const { sheets, bar } = followed();
		if (!first) {
			const fresh = sheets.some((el) => !old.has(el) && el.offsetWidth > 0 && el.checkVisibility({ visibilityProperty: true }));
			// A page that draws no sheet (the Graph) is watched from the end of its travel in.
			const arriving = document.querySelector(".lh-travel[data-way] > .lh-travel-page");
			traveled ||= !!arriving;
			const bare = traveled && !arriving && !fresh;
			if (location.pathname !== path || !(fresh || bare)) {
				watch.framesBefore++;
				frames.next();
				return;
			}
			watch.firstAt = now;
			first = {};
			for (const el of [...sheets, ...bar]) {
				first[idOf(el)] = layoutBox(el);
				watch.els[idOf(el)] = el;
			}
			const all = [...document.querySelectorAll("*")];
			atFirst = new WeakSet(all);
			scrollAt = new Map(all.filter((el) => el.scrollTop).map((el) => [el, el.scrollTop]));
			scrolled.clear();
		}
		const ms = Math.round(now - watch.firstAt);
		const later = {};
		for (const [id, el] of Object.entries(watch.els)) if (el.isConnected) later[id] = layoutBox(el);
		for (const el of sheets) if (!(idOf(el) in first)) later[idOf(el)] = layoutBox(el);
		const { moved, arrived } = movedSince(first, later);
		for (const move of moved) {
			const seen = (watch.moves[move.id] ??= { ...move, at: ms, last: ms, steps: 0 });
			if (!last[move.id] || !move.to || boxMoved(last[move.id], move.to)) seen.steps++;
			Object.assign(seen, { to: move.to, last: ms });
			last[move.id] = move.to;
		}
		for (const id of arrived) watch.arrivals[id] ??= { el: sheets.find((el) => String(idOf(el)) === id), at: ms };
		for (const el of scrolled) {
			const from = scrollAt.get(el) ?? 0;
			if (Math.abs(el.scrollTop - from) <= SLACK) continue;
			const seen = watch.scrolls.get(el);
			if (seen) seen.to = el.scrollTop;
			else watch.scrolls.set(el, { from, to: el.scrollTop, at: ms });
		}
		for (const animation of document.getAnimations()) {
			const effect = animation.effect;
			const target = effect?.target;
			if (!target || animation.playState !== "running" || effect.getTiming().iterations === Infinity) continue;
			// What arrived after the first paint is the arrival's to judge, not its motion.
			if (!atFirst.has(target) || openingAllowed(animation, target)) continue;
			// The innermost followed box it plays in names it best.
			const owners = Object.values(watch.els).filter((el) => el.contains(target));
			if (owners.length === 0) continue;
			const owner = owners.reduce((outer, inner) => (outer.contains(inner) ? inner : outer));
			const name = animation.animationName ?? (animation.transitionProperty ? `a transition of ${animation.transitionProperty}` : "a script's animation");
			const key = `${idOf(owner)} ${name}`;
			const seen = (watch.motions[key] ??= { owner, target, name, at: ms, ms: Math.round(effect.getComputedTiming().endTime), targets: new Set() });
			seen.targets.add(target);
		}
		if (now - watch.firstAt < WATCH_MS) {
			frames.next();
			return;
		}
		frames.stop();
		removeEventListener("scroll", onScroll, { capture: true });
		watch.done = true;
	};
	const frames = drawnFrames(frame);
	frames.next();
}

/** What the opening watch saw, once it is done: whether the new page painted, how many frames
 *  of the old page it watched first, and its findings. */
export function openingFindings() {
	const watch = window.__layoutOpening;
	if (!watch?.done) return { painted: watch?.firstAt != null, done: false, framesBefore: watch?.framesBefore ?? 0, findings: [] };
	const after = (ms) => `${ms} ms after the page first showed`;
	const found = [];
	const moves = Object.values(watch.moves);
	for (const move of moves) {
		const el = watch.els[move.id];
		const outer = moves.find((other) => other !== move && watch.els[other.id].contains(el));
		if (outer && carried(move, outer)) continue;
		if (!move.to) found.push(finding("moved after opening", [el], `${label(el)} left the page ${after(move.at)}`));
		else found.push(finding("moved after opening", [el], `${label(el)} moved from ${boxWords(move.from)} to ${boxWords(move.to)}: first ${after(move.at)}, last at ${move.last} ms, in ${move.steps} ${move.steps === 1 ? "step" : "steps"}`));
	}
	const arrivals = Object.values(watch.arrivals).filter(({ el }) => el);
	for (const { el, at } of arrivals) {
		if (arrivals.some((other) => other.el !== el && other.el.contains(el))) continue;
		found.push(finding("moved after opening", [el], `${label(el)} arrived ${after(at)}`));
	}
	const scroller = mainScroller();
	const scroll = scroller && watch.scrolls.get(scroller);
	if (scroll) found.push(finding("moved after opening", [scroller], `${label(scroller)} scrolled from ${Math.round(scroll.from)} to ${Math.round(scroll.to)} px, first ${after(scroll.at)}`));
	for (const motion of Object.values(watch.motions)) {
		const more = motion.targets.size - 1;
		const inside = motion.owner === motion.target ? "" : ` inside ${label(motion.owner)}`;
		found.push(finding("arrival motion", [motion.owner], `${label(motion.target)}${inside} plays ${motion.name} (${motion.ms} ms) ${after(motion.at)}${more > 0 ? `, and ${more} more ${more === 1 ? "thing" : "things"} there` : ""}`));
	}
	return { painted: true, done: true, framesBefore: watch.framesBefore, findings: found };
}

/** Every finding on the page as it is now, each once. */
/** Keys: a key's words keep room inside its edge; a list of things to open is rows, not a pile
 *  of keys; a key is as wide as its words; a title wraps, it is never cut. A bar's own words
 *  (the crumb that gives way) are the bar's, not a title. */
const KEY_PAD_MIN = 8;
/** The tallest key size (BIG_KEY and MAIN_KEY, 48), with room for its shadow. */
const KEY_MAX_H = 54;
const OUTSIDE_PAGE = ".lh-app-bar, .lh-own-bar, .lh-popup, [role=dialog], [role=menu], [aria-hidden=true]";
const keyText = (key) => key.innerText.replace(/\s+/g, " ").trim();

/** Whether a key's side padding leaves its words room: less than KEY_PAD_MIN on a side is tight. */
export function tightPad(left, right) {
	return Math.min(left, right) < KEY_PAD_MIN;
}

/** How many lines a set of boxes' tops sit on, rounding a pixel or two of difference away. */
export function linesOf(tops) {
	const lines = [];
	for (const top of [...tops].sort((a, b) => a - b)) if (lines.length === 0 || top - lines.at(-1) > SLACK) lines.push(top);
	return lines.length;
}

/** A key is wide when it is more than 96 points wider than its words and padding need. */
export function tooWide(width, need) {
	return width - need > 96;
}

function keyChecks() {
	const found = [];
	// A key clipped to a pixel (text for screen readers until focused) is not on the page.
	const keys = [...document.querySelectorAll(".lh-btn")].filter((key) => {
		const { width, height } = key.getBoundingClientRect();
		return shown(key) && width > SLACK && height > SLACK && !key.closest(OUTSIDE_PAGE);
	});
	for (const key of keys) {
		if (keyText(key).length < 2) continue;
		const style = getComputedStyle(key);
		const left = parseFloat(style.paddingLeft);
		const right = parseFloat(style.paddingRight);
		if (tightPad(left, right)) found.push(finding("tight key", [key], `${label(key)} keeps ${Math.min(left, right)} px beside its words; a key keeps at least ${KEY_PAD_MIN}`));
		const range = document.createRange();
		range.selectNodeContents(key);
		const words = range.getBoundingClientRect().width;
		const { width } = key.getBoundingClientRect();
		if (tooWide(width, words + left + right)) found.push(finding("wide key", [key], `${label(key)} is ${Math.round(width)} px wide for ${Math.round(words)} px of words`));
	}
	// A pile: three or more keys stacked on three or more lines in one group. A card drawn as one
	// big key (a deadline's row) is taller than any key size and is not counted.
	// Only a key that is its whole item counts: a row that holds words and a key of its own is a row.
	const bare = (key) => {
		const item = key.closest("li") ?? key;
		return keyText(item) === keyText(key);
	};
	const small = keys.filter((key) => key.getBoundingClientRect().height <= KEY_MAX_H && bare(key));
	const groupOf = (key) => key.closest("ul, ol") ?? key.parentElement?.closest(":not(li)");
	for (const group of new Set(small.map(groupOf))) {
		if (!group) continue;
		const inGroup = small.filter((key) => groupOf(key) === group);
		if (inGroup.length >= 3 && linesOf(inGroup.map((key) => key.getBoundingClientRect().top)) >= 3) found.push(finding("key pile", [group], `${label(group)} stacks ${inGroup.length} keys; a list of things to open is rows`));
	}
	for (const title of document.querySelectorAll("h1, h2, h3, h4, .lh-card-title")) {
		if (!shown(title) || title.closest(OUTSIDE_PAGE)) continue;
		const cut = [title, ...title.querySelectorAll("*")].find((el) => getComputedStyle(el).textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1);
		if (cut) found.push(finding("cut title", [title], `${label(title)} is cut with "..."; a title wraps`));
	}
	return found;
}

export function checkPage() {
	const all = [...overlaps(), ...covereds(), ...spills(), ...sideways(), ...hiddens(), ...cutOffs(), ...turnFoot(), ...spacings(), ...barKeys(), ...emptyBoxes(), ...hollowBoxes(), ...emptyRooms(), ...cutStarts(), ...brokenPictures(), ...keyChecks()];
	const seen = new Set();
	return all.filter((f) => !seen.has(f.key) && seen.add(f.key));
}
