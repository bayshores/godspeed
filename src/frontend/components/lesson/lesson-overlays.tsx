/** What opens over the lesson area: a diagram or figure close up, the plan,
 *  and the confirm that skips a question or discards a problem. */

import { useCallback, useMemo, useRef, useState } from "react";
import type { PlanTree } from "@/shared/core";
import { AbortTurnDialog, type AbortMode } from "@/frontend/components/abort-turn-dialog";
import type { PopupMessage } from "@/frontend/components/plan-latest";
import { usePresence } from "@/frontend/components/presence";
import { MermaidOverlay } from "@/frontend/components/session-overlay";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { cn } from "@/frontend/lib/utils";

// The plan popup (and dagre, its layout engine) loads on first open.
const PlanPopup = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanPopup));

type Figure = { svg: string; inverted: boolean };

/** Which overlay is open, and the openers the lesson text calls. */
export function useLessonOverlays() {
	const [planOpen, setPlanOpen] = useState(false);
	const openPlan = useCallback(() => setPlanOpen(true), []);
	const [mermaid, setMermaid] = useState<string | null>(null);
	const [figure, setFigure] = useState<Figure | null>(null);
	const closeMermaid = useCallback(() => setMermaid(null), []);
	const mermaidActions = useMemo(() => ({ openMermaid: setMermaid, openFigure: (svg: string, inverted: boolean) => setFigure({ svg, inverted }) }), []);
	return {
		planOpen,
		openPlan,
		closePlan: () => setPlanOpen(false),
		mermaid,
		figure,
		closeMermaid,
		closeFigure: () => setFigure(null),
		focusOpen: mermaid !== null || figure !== null,
		mermaidActions,
	};
}

export function LessonOverlays({
	overlays,
	planTree,
	messages,
	abort,
}: {
	overlays: ReturnType<typeof useLessonOverlays>;
	planTree: PlanTree | null;
	messages: readonly PopupMessage[];
	abort: { mode: AbortMode | null; onClose: () => void; onConfirm: () => void; busy: boolean };
}) {
	const { mermaid, figure } = overlays;
	const planPresence = usePresence(overlays.planOpen);
	const mermaidPresence = usePresence(mermaid !== null);
	const figurePresence = usePresence(figure !== null);
	// The last focus each overlay showed, held through its exit fade.
	const lastMermaidRef = useRef(mermaid);
	if (mermaid !== null) lastMermaidRef.current = mermaid;
	const lastFigureRef = useRef(figure);
	if (figure !== null) lastFigureRef.current = figure;
	return (
		<>
			{/* The session-scoped focuses: absolute over the lesson area, below
			    the lesson's bar; each fades out through usePresence. */}
			{mermaidPresence.mounted && lastMermaidRef.current !== null && (
				<div className={cn("absolute inset-0 z-40", mermaidPresence.state === "closed" && "lh-fade")} data-state={mermaidPresence.state}>
					<MermaidOverlay chart={lastMermaidRef.current} onClose={overlays.closeMermaid} />
				</div>
			)}
			{figurePresence.mounted && lastFigureRef.current !== null && (
				<div className={cn("absolute inset-0 z-40", figurePresence.state === "closed" && "lh-fade")} data-state={figurePresence.state}>
					<MermaidOverlay svg={lastFigureRef.current.svg} inverted={lastFigureRef.current.inverted} onClose={overlays.closeFigure} />
				</div>
			)}
			{planPresence.mounted && <PlanPopup tree={planTree} messages={messages} onClose={overlays.closePlan} state={planPresence.state} />}
			<AbortTurnDialog mode={abort.mode} onClose={abort.onClose} onConfirm={abort.onConfirm} busy={abort.busy} />
		</>
	);
}
