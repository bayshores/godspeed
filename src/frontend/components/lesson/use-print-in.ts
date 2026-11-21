import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { linesOf, printSchedule } from "./print-in-model";

/** What prints: the blocks of the reply's text, and the cited page and the Sources list as one block each. */
const BLOCKS = ".lh-prose > *, [data-testid^=page-excerpt], [data-testid=cite-list]";
/** Blocks made of plain lines of text; the rest (a table, a figure, code, display math) appear whole. */
const TEXT_TAGS: ReadonlySet<string> = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE"]);

/** A landed reply waits to print (the book's pages are on their way: useBook's `turning`). */
export const PrintWaitContext = createContext(false);

/**
 * Prints a reply that just `landed`: each block under the element that takes the returned ref is
 * uncovered line by line, top to bottom, one block after the other (printSchedule). It runs once, on the first
 * render that has blocks, and outlives the short time `landed` is true. While PrintWaitContext
 * says so the reply stays covered, and prints once it no longer does. Nothing moves or changes
 * size, and with reduced motion nothing is covered.
 */
export function usePrintIn(landed: boolean): RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement>(null);
	const printed = useRef(false);
	const wait = useContext(PrintWaitContext);
	const waiting = useRef<Animation[]>([]);
	useLayoutEffect(() => {
		const root = ref.current;
		if (!landed || printed.current || !root || prefersReducedMotion()) return;
		const blocks = [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter((block) => typeof block.animate === "function");
		if (blocks.length === 0) return;
		printed.current = true;
		const lines = blocks.map((block) => (TEXT_TAGS.has(block.tagName) ? linesOf(block.getBoundingClientRect().height, parseFloat(getComputedStyle(block).lineHeight)) : 1));
		printSchedule(lines).forEach((step, i) => {
			// The sides stay open, so nothing that hangs out of a block (a list's marks) is cut.
			const print = blocks[i]!.animate([{ clipPath: "inset(0 -100vw 100% -100vw)" }, { clipPath: "inset(0 -100vw 0% -100vw)" }], {
				duration: step.ms,
				delay: step.at,
				easing: `steps(${step.lines}, jump-start)`,
				fill: "backwards",
			});
			if (wait) {
				print.pause();
				waiting.current.push(print);
			}
		});
	});
	useLayoutEffect(() => {
		if (wait) return;
		for (const print of waiting.current.splice(0)) print.play();
	}, [wait]);
	return ref;
}
