import { useEffect, useRef } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { HeaderChip, PanelBody, PanelHeader, StopButton } from "./panel-parts";
import { TurnStatus } from "./turn-status";

/**
 * A homework problem in the Your turn panel: the whole problem, always in
 * view, scrolled to the part the teacher marked. The learner works in the
 * lesson's message box, so the panel holds no writing box of its own.
 */
export function HomeworkProblemPane({
	statement,
	source,
	part,
	busy,
	waitingForAgent,
	onDiscard,
	onStop,
	footer,
}: {
	statement: string;
	/** Where it is in the assignment. */
	source: string | null;
	/** The part the learner is on, as the problem labels it. */
	part: string | null;
	busy: boolean;
	waitingForAgent: boolean;
	onDiscard: () => void;
	onStop?: () => void;
	footer: React.ReactNode;
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
		<div data-testid="homework-problem" className="flex min-h-0 flex-1 flex-col">
			{/* The header and footer stay put while the problem scrolls between them. */}
			<div className="shrink-0 px-6 pt-6">
				<PanelHeader
					status={busy && <TurnStatus waitingForAgent={waitingForAgent} />}
					right={
						<HeaderChip exit={{ label: "Discard problem", testId: "discard-problem", onClick: onDiscard }}>
							{busy && onStop && <StopButton onStop={onStop} />}
						</HeaderChip>
					}
				/>
			</div>
			<PanelBody className="pt-1 pb-3">
				<div ref={statementRef} data-testid="homework-statement" className="lh-prose py-3 text-[15px] text-ink">
					<ToolContentResponse>{statement}</ToolContentResponse>
				</div>
				{source && (
					<p data-testid="problem-source" className="text-[13px] text-ink-3">
						{source}
					</p>
				)}
			</PanelBody>
			<div className="shrink-0 px-6 pb-5">{footer}</div>
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
