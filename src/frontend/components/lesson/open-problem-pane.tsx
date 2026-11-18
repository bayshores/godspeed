import { useEffect, useRef, useState } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { partMarks, toggled, type PartMarks } from "./problem-parts";
import { proseVars } from "./question-parts";

const MARKED = "[data-part-current], [data-part-head], [data-part-fold]";
const NAMES = ["data-part-current", "data-part-head", "data-part-fold", "role", "tabindex", "aria-expanded"];

/** Puts `marks` on the statement's blocks and takes the old ones off, touching
 *  only what changes, so a focused part keeps its focus. */
function apply(root: HTMLElement, marks: PartMarks) {
	for (const el of root.querySelectorAll<HTMLElement>(MARKED)) {
		const keep = marks.get(el) ?? {};
		for (const name of NAMES) if (!(name in keep)) el.removeAttribute(name);
	}
	for (const [el, attrs] of marks) {
		for (const [name, value] of Object.entries(attrs)) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
	}
}

/**
 * The open problem under "Your turn": the whole problem, the part the teacher
 * marked open (data-part-current, where the page may rest) and every other
 * part folded to its first line, which opens it on a click and folds it on
 * the next. The learner works on it in the writing box under it.
 */
export function OpenProblemPane({
	statement,
	part,
}: {
	statement: string;
	/** The part the learner is on, as the problem labels it (homework only). */
	part: string | null;
}) {
	const statementRef = useRef<HTMLDivElement>(null);
	// The other parts the learner opened; a newly marked part folds them again.
	const [opened, setOpened] = useState<readonly string[]>([]);
	const [openedFor, setOpenedFor] = useState(part);
	if (openedFor !== part) {
		setOpenedFor(part);
		setOpened([]);
	}

	// Clicks and keys on the other parts' first lines; the marks go with the part.
	useEffect(() => {
		const root = statementRef.current;
		if (!part || !root) return;
		const toggle = (e: Event) => {
			const target = e.target as Element;
			const head = target.closest("[data-part-head]");
			if (!head || target.closest("a")) return;
			e.preventDefault();
			setOpened((now) => toggled(now, head.getAttribute("data-part-head")!));
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") toggle(e);
		};
		root.addEventListener("click", toggle);
		root.addEventListener("keydown", onKey);
		return () => {
			root.removeEventListener("click", toggle);
			root.removeEventListener("keydown", onKey);
			apply(root, new Map());
		};
	}, [part]);
	useEffect(() => {
		const root = statementRef.current;
		if (!part || !root) return;
		const mark = () => apply(root, partMarks(root, part, opened));
		mark();
		// Code and math finish drawing after this.
		const ro = new ResizeObserver(mark);
		ro.observe(root);
		return () => ro.disconnect();
	}, [part, opened]);

	return (
		<div data-testid="open-problem" className="flex flex-col gap-2">
			{/* Holds a last-line fraction's denominator, which hangs 6px below its line box. */}
			<div ref={statementRef} data-testid="problem-statement" className="pb-1.5" style={proseVars(18, 28)}>
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
		</div>
	);
}
