/**
 * layout-page.mjs — the layout check that runs inside the app's window. layout.mjs sends this
 * file through the screens channel's `eval` with `export` taken out and calls checkPage(), which
 * answers a list of findings `{ check, what }`. The rect helpers are exported for the tests.
 *
 * - overlap: two elements that draw their own text, or are buttons, inputs or images, cross.
 * - spill: an element sticks out of its parent's box, up or down, while the parent neither
 *   scrolls nor clips.
 * - sideways: the page, or a panel at least half the window tall, scrolls sideways.
 * - cut-off letters: a box that clips (truncate, line-clamp, overflow-hidden) cuts off the top or
 *   bottom of letters it shows, such as the tail of a "g".
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

/** Whole pixels of ink cut off by a clip box at the top and the bottom; under 1 px is rounding. */
export function cutOf(ink, clip) {
	const cut = (px) => (px >= 1 ? Math.round(px) : 0);
	return { top: cut(clip.top - ink.top), bottom: cut(ink.bottom - clip.bottom) };
}

const clips = (style) => style.overflowX !== "visible" || style.overflowY !== "visible";

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
	if (el.matches("button, input, select, textarea, img, svg, canvas, video, .katex")) return [el.getBoundingClientRect()];
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

/** A box that draws on its own layer over the page: fixed or sticky bars, and positioned
 *  boxes with a z-index (popovers, tooltips, the dim behind a dialog). */
function layerOf(el) {
	for (let node = el; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (style.position === "fixed" || style.position === "sticky" || (style.position !== "static" && style.zIndex !== "auto")) return node;
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
		// Math is drawn by KaTeX and SVG by its own geometry: each is one picture. What the app
		// marks aria-hidden is decoration (a backdrop, an icon in a button), not content.
		if ((el.closest(".katex") && !el.matches(".katex")) || (el.closest("svg") && el.localName !== "svg") || el.closest("[aria-hidden=true]") || !shown(el)) continue;
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
			if (a.boxes.some((x) => b.boxes.some((y) => cross(x, y)))) found.push({ check: "overlap", what: `${label(a.el)} and ${label(b.el)}` });
		}
	}
	return found;
}

/**
 * Spill: an in-flow block box whose parent neither scrolls nor clips, sticking out of that
 * parent up or down. Out-of-flow boxes (absolute, fixed) are placed on purpose, and inline
 * boxes follow the line, so neither is measured.
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
		if (sticksOut(box, parent.getBoundingClientRect())) found.push({ check: "spill", what: `${label(el)} sticks out of ${label(parent)}` });
	}
	return found;
}

/** Sideways scrolling: the page, or a scrolling panel at least half the window tall (smaller
 *  scrollers such as code blocks and tab strips scroll sideways on purpose). */
function sideways() {
	const found = [];
	const page = document.scrollingElement;
	if (page.scrollWidth > page.clientWidth + 1) found.push({ check: "sideways", what: `the page is ${page.scrollWidth} wide in ${page.clientWidth}` });
	for (const el of document.body.querySelectorAll("*")) {
		const style = getComputedStyle(el);
		if (!["auto", "scroll"].includes(style.overflowX) || el.clientHeight < innerHeight / 2 || !shown(el)) continue;
		if (el.scrollWidth > el.clientWidth + 1) found.push({ check: "sideways", what: `${label(el)} is ${el.scrollWidth} wide in ${el.clientWidth}` });
	}
	return found;
}

/** The boxes that clip `el`'s text top and bottom: it and its ancestors with overflow hidden or
 *  clip, up to the first scroller. A scroller cuts what is scrolled out of view on purpose. */
function textClips(el) {
	const found = [];
	for (let node = el; node && node !== document.body; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (style.overflowY === "auto" || style.overflowY === "scroll") break;
		if (style.overflowY === "hidden" || style.overflowY === "clip") {
			const box = node.getBoundingClientRect();
			const top = box.top + node.clientTop;
			found.push({ node, left: box.left, right: box.right, top, bottom: top + node.clientHeight });
		}
		if (style.position === "fixed") break;
	}
	return found;
}

/**
 * Cut-off letters. For each line of text a box clips, the letters' ink (inkOf) must stay inside
 * it. A line whose middle is outside the box is hidden on purpose (the lines line-clamp drops,
 * the letters truncate replaces with "..."), so only lines the box shows are measured. A line
 * that may be cut is measured again letter by letter, to name the letter.
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
		const clipping = textClips(el);
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
		if (worst) found.push({ check: "cut-off letters", what: `${label(el)}: the "${worst.letter}" loses ${worst.px} px at the ${worst.side}, clipped by ${worst.clip === el ? "its own box" : label(worst.clip)}` });
	}
	return found;
}

/** Every finding on the page as it is now, each once. */
export function checkPage() {
	const all = [...overlaps(), ...spills(), ...sideways(), ...cutOffs()];
	const seen = new Set();
	return all.filter((f) => !seen.has(f.check + f.what) && seen.add(f.check + f.what));
}
