/**
 * A still copy of a page as it looks now, to leave the window while the
 * next page arrives. Nothing in it runs: its frames are empty and its
 * motion is off (globals.css).
 */
export interface StillCopy {
	node: HTMLElement;
	/** Once the copy is in the document: every scrolled box back where it was. */
	scroll: () => void;
}

export function stillCopy(page: HTMLElement): StillCopy {
	const node = page.cloneNode(true) as HTMLElement;
	// The copy has the same elements in the same order.
	const copies = [node, ...node.querySelectorAll("*")];
	const scrolled: [Element, number, number][] = [];
	[page, ...page.querySelectorAll("*")].forEach((el, i) => {
		const copy = copies[i];
		if (copy && (el.scrollTop || el.scrollLeft)) scrolled.push([copy, el.scrollTop, el.scrollLeft]);
	});
	// A copied canvas is blank, and a copied frame would load its page again.
	const drawn = node.querySelectorAll("canvas");
	page.querySelectorAll("canvas").forEach((canvas, i) => {
		if (canvas.width && canvas.height) drawn[i]?.getContext("2d")?.drawImage(canvas, 0, 0);
	});
	for (const frame of node.querySelectorAll("iframe")) {
		frame.removeAttribute("src");
		frame.removeAttribute("srcdoc");
	}
	// A page caught while a page inside it travels: only what arrives is kept.
	for (const old of node.querySelectorAll(".lh-travel-old")) old.replaceChildren();
	for (const inner of node.querySelectorAll(".lh-travel[data-way]")) inner.removeAttribute("data-way");
	return {
		node,
		scroll: () => {
			for (const [el, top, left] of scrolled) el.scrollTo(left, top);
		},
	};
}
