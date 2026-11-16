import { useEffect, useRef } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { otherParts, partElement, scrollParent } from "./problem-parts";
import { proseVars } from "./question-parts";

/**
 * The open problem in the teacher column: the whole problem, scrolled to
 * the part the teacher marked, with the other parts lighter. The learner
 * works on it in the writing box under it.
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
	useEffect(() => {
		const root = statementRef.current;
		if (!part || !root) return;
		const show = (behavior: ScrollBehavior) => {
			const others = otherParts(root, part);
			for (const el of root.querySelectorAll("[data-other-part]")) {
				if (!others.includes(el as HTMLElement)) el.removeAttribute("data-other-part");
			}
			for (const el of others) el.setAttribute("data-other-part", "");
			const target = partElement(root, part);
			if (!target) return;
			target.scrollIntoView({ block: "start", behavior });
		};
		show(prefersReducedMotion() ? "auto" : "smooth");
		// Code and math finish drawing after this, and a shorter window shrinks the scroller: both move the part.
		const ro = new ResizeObserver(() => show("auto"));
		ro.observe(root);
		const scroller = scrollParent(root);
		if (scroller) ro.observe(scroller);
		return () => ro.disconnect();
	}, [part]);

	return (
		<div data-testid="open-problem" className="flex shrink-0 flex-col gap-2">
			{/* Holds a last-line fraction's denominator, which hangs 6px below its line box and would add a scroll range. */}
			<div ref={statementRef} data-testid="problem-statement" className="pb-1.5" style={proseVars(18, 26)}>
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
		</div>
	);
}
