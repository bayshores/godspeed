import { useEffect, useRef } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { otherParts, partElement } from "./problem-parts";
import { proseVars } from "./question-parts";

/**
 * The open problem under "Your turn": the whole problem, the part the
 * teacher marked in full ink (data-part-current, where the page may rest)
 * and the other parts lighter. The learner works on it in the writing box
 * under it.
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
		const mark = () => {
			const others = otherParts(root, part);
			const current = partElement(root, part);
			for (const el of root.querySelectorAll("[data-other-part], [data-part-current]")) {
				if (!others.includes(el as HTMLElement)) el.removeAttribute("data-other-part");
				if (el !== current) el.removeAttribute("data-part-current");
			}
			for (const el of others) el.setAttribute("data-other-part", "");
			current?.setAttribute("data-part-current", "");
		};
		mark();
		// Code and math finish drawing after this.
		const ro = new ResizeObserver(mark);
		ro.observe(root);
		return () => {
			ro.disconnect();
			for (const el of root.querySelectorAll("[data-other-part], [data-part-current]")) {
				el.removeAttribute("data-other-part");
				el.removeAttribute("data-part-current");
			}
		};
	}, [part]);

	return (
		<div data-testid="open-problem" className="flex flex-col gap-2">
			{/* Holds a last-line fraction's denominator, which hangs 6px below its line box. */}
			<div ref={statementRef} data-testid="problem-statement" className="pb-1.5" style={proseVars(18, 28)}>
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
		</div>
	);
}
