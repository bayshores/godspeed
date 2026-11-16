import { escapeRegex } from "@/shared/core";

/** What a part is called: a letter, a small number or a roman numeral. */
const LABEL = "[a-z]|\\d{1,2}|[ivx]{1,4}";

/** A block that starts the part `label`: "(b) …", "b) …", "b. …" or "Part b …". */
function startOf(label: string): RegExp {
	return new RegExp(`^\\s*(?:\\((${label})\\)|(${label})[).:](?=\\s|$)|part\\s+\\(?(${label})\\b)`, "i");
}

const ANY_START = startOf(LABEL);
const BLOCKS = "p, li, h1, h2, h3, h4";

/** "b" for a block that starts part b, in lower case. */
function labelOf(el: HTMLElement): string | null {
	const m = ANY_START.exec(el.textContent ?? "");
	return m ? (m[1] ?? m[2] ?? m[3]!).toLowerCase() : null;
}

/** Letters, numbers and numerals each run their own list. */
function family(label: string): string {
	return /^\d/.test(label) ? "number" : label.length === 1 ? "letter" : "numeral";
}

/** Whether `label` comes right after `prev` in a list: a letter or number follows its
 *  predecessor, so the (i) inside part (a) is not part (i). */
function follows(label: string, prev: string): boolean {
	if (family(label) === "number") return Number(label) === Number(prev) + 1;
	return family(label) === "numeral" || label.charCodeAt(0) === prev.charCodeAt(0) + 1;
}

/** The block that starts the part the learner is on. */
export function partElement(root: HTMLElement, part: string): HTMLElement | null {
	const start = startOf(escapeRegex(part));
	for (const el of root.querySelectorAll<HTMLElement>(BLOCKS)) {
		if (start.test(el.textContent ?? "")) return el;
	}
	return null;
}

/**
 * The blocks that belong to the other parts, from each one's first block to
 * the next part's. The text before the first part is shared and never
 * returned. Nothing when the parts are not all siblings or the current one
 * is not found: a layout this cannot read stays whole.
 */
export function otherParts(root: HTMLElement, part: string): HTMLElement[] {
	const current = partElement(root, part);
	const label = current && labelOf(current);
	if (!current || !label) return [];
	const starts = new Map<HTMLElement, string>();
	let last: HTMLElement | null = null;
	let prev: string | undefined;
	for (const el of root.querySelectorAll<HTMLElement>(BLOCKS)) {
		// A block inside the one that started a part is part of it.
		if (last?.contains(el)) continue;
		const own = labelOf(el);
		if (own && family(own) === family(label) && (prev === undefined || follows(own, prev))) {
			starts.set(el, own);
			last = el;
			prev = own;
		}
	}
	const parent = current.parentElement;
	if (!parent || !starts.has(current) || ![...starts.keys()].every((el) => el.parentElement === parent)) return [];
	const others: HTMLElement[] = [];
	let dim = false;
	for (const child of Array.from(parent.children) as HTMLElement[]) {
		const own = starts.get(child);
		if (own !== undefined) dim = own !== label;
		if (dim) others.push(child);
	}
	return others;
}

/** The nearest ancestor that scrolls. */
export function scrollParent(el: HTMLElement): HTMLElement | null {
	for (let parent = el.parentElement; parent; parent = parent.parentElement) {
		if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
	}
	return null;
}
