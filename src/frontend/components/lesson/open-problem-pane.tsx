import { useEffect, useRef } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { proseVars } from "./question-parts";

/**
 * The open problem in the teacher column: the whole problem, scrolled to
 * the part the teacher marked. The learner works on it in the writing box
 * under it.
 */
export function OpenProblemPane({
	statement,
	source,
	part,
}: {
	statement: string;
	/** Where it is in the assignment (homework only). */
	source: string | null;
	/** The part the learner is on, as the problem labels it (homework only). */
	part: string | null;
}) {
	const statementRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const root = statementRef.current;
		if (!part || !root) return;
		const show = (behavior: ScrollBehavior) => partElement(root, part)?.scrollIntoView({ block: "start", behavior });
		show(prefersReducedMotion() ? "auto" : "smooth");
		// Code and math finish drawing after this, moving the part down.
		const ro = new ResizeObserver(() => show("auto"));
		ro.observe(root);
		return () => ro.disconnect();
	}, [part]);

	return (
		<div data-testid="open-problem" className="flex shrink-0 flex-col gap-2">
			<div ref={statementRef} data-testid="problem-statement" style={proseVars(18, 26)}>
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
			{source && (
				<p data-testid="problem-source" className="text-[15px] text-ink-2">
					{source}
				</p>
			)}
		</div>
	);
}

/** The block that starts the part: "(b) …", "b) …", "b. …" or "Part b …". */
function partElement(root: HTMLElement, part: string): HTMLElement | null {
	const p = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const start = new RegExp(`^\\s*(\\(${p}\\)|${p}[).:]|part\\s+\\(?${p}\\b)`, "i");
	for (const el of root.querySelectorAll<HTMLElement>("p, li, h1, h2, h3, h4")) {
		if (start.test(el.textContent ?? "")) return el;
	}
	return null;
}
