import { useCallback, useEffect, useMemo, useRef } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { useNavigate, useSearchParams } from "react-router";
import { lessonStop, type FileProblem, type LessonKind, type LhMessage, type PlanTree } from "@/shared/core";
import { highlight, isInView } from "@/frontend/components/teacher/dom";
import { useStableValue } from "@/frontend/lib/use-stable-value";
import { stopLightSelector } from "./lesson-stop-model";

/** How long the reading pane takes to stick to its bottom on open. */
const SETTLE_MS = 300;

/**
 * The lesson's stop (split out of chat.tsx): the stop read from the
 * record and the live stream, the one he has not kept going from, Done for
 * today, and the Concluded card lit once when he comes back from Home's
 * Continue (?lit=stop).
 */
export function useLessonStop({
	nativeMessages,
	kind,
	tree,
	problems,
	deadlineId,
	scopeRef,
	scrollContextRef,
}: {
	nativeMessages: readonly LhMessage[];
	kind: LessonKind;
	tree: PlanTree | null;
	/** A homework lesson's problems. */
	problems: readonly FileProblem[] | null;
	deadlineId: string | undefined;
	scopeRef: React.RefObject<HTMLElement | null>;
	scrollContextRef: React.RefObject<StickToBottomContext | null>;
}) {
	const fresh = useMemo(
		() => lessonStop(nativeMessages, kind === "study" ? tree : null, problems ?? undefined),
		[nativeMessages, kind, tree, problems],
	);
	// Stable while nothing in it changed, so streaming never redraws the plan row.
	const stop = useStableValue(fresh);

	// Done for today goes back to Home, its deadline's card lit when the lesson has one.
	const navigate = useNavigate();
	const doneForToday = useCallback(() => {
		navigate(deadlineId ? `/?lit=${encodeURIComponent(`deadline:${deadlineId}`)}` : "/");
	}, [navigate, deadlineId]);
	const atStop = stop && !stop.keptGoing ? stop : null;

	// Back from Home's Continue: light the stop's card once, then drop the parameter.
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

	return { stop, atStop, doneForToday };
}
