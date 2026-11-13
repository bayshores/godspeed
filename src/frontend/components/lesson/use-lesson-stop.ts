import { useCallback, useEffect, useMemo, useRef } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { useNavigate, useSearchParams } from "react-router";
import { lessonStop, type HomeworkProblem, type LessonKind, type LhMessage, type PlanTree } from "@/shared/core";
import { highlight, isInView } from "@/frontend/components/halley/dom";
import { stopCard, stopLightSelector, type StopAction } from "./stop-card-model";

/** How long the reading pane takes to stick to its bottom on open. */
const SETTLE_MS = 300;

/**
 * The lesson's stop (split out of chat.tsx): the stop read from the
 * record and the live stream, the stop card's buttons, and the Concluded
 * card lit once when he comes back from Today's Continue (?lit=stop).
 */
export function useLessonStop({
	nativeMessages,
	kind,
	tree,
	problems,
	deadlineId,
	keepGoing,
	scopeRef,
	scrollContextRef,
}: {
	nativeMessages: readonly LhMessage[];
	kind: LessonKind;
	tree: PlanTree | null;
	/** A homework lesson's problems. */
	problems: readonly HomeworkProblem[] | null;
	deadlineId: string | undefined;
	keepGoing: (stopOf: string) => void;
	scopeRef: React.RefObject<HTMLElement | null>;
	scrollContextRef: React.RefObject<StickToBottomContext | null>;
}) {
	const fresh = useMemo(
		() => lessonStop(nativeMessages, kind === "study" ? tree : null, problems ?? undefined),
		[nativeMessages, kind, tree, problems],
	);
	// Stable while nothing in it changed, so streaming never redraws the plan row.
	const key = fresh ? JSON.stringify(fresh) : "";
	const stop = useMemo(() => fresh, [key]);

	const navigate = useNavigate();
	const onAction = useCallback(
		(action: StopAction) => {
			if (action === "keep-going") {
				if (stop) keepGoing(stop.stopOf);
				return;
			}
			navigate(deadlineId ? `/?lit=${encodeURIComponent(`deadline:${deadlineId}`)}` : "/");
		},
		[stop, keepGoing, navigate, deadlineId],
	);
	const card = useMemo(() => (stop && !stop.keptGoing ? { key: stop.stopOf, view: stopCard(stop), onAction } : null), [stop, onAction]);

	// Back from Today's Continue: light the stop's card once, then drop the parameter.
	const [params, setParams] = useSearchParams();
	const lit = params.get("lit") === "stop";
	const messagesRef = useRef(nativeMessages);
	messagesRef.current = nativeMessages;
	useEffect(() => {
		if (!lit) return;
		// After the pane has stuck to its bottom: scroll only when the card is out of view.
		const timer = setTimeout(() => {
			const selector = stop && stopLightSelector(messagesRef.current, stop.stopOf);
			const el = selector ? scopeRef.current?.querySelector<HTMLElement>(selector) : null;
			if (el) {
				if (!isInView(el)) {
					scrollContextRef.current?.stopScroll();
					el.scrollIntoView({ block: "start" });
				}
				highlight(el);
			}
			setParams(
				(p) => {
					p.delete("lit");
					return p;
				},
				{ replace: true },
			);
		}, SETTLE_MS);
		return () => clearTimeout(timer);
	}, [lit, stop, scopeRef, scrollContextRef, setParams]);

	return { stop, card };
}
