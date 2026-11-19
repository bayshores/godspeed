/** The tour: the agent's changes visited one by one, each on its page (when
 *  following, or when the learner or the agent asked) with its item lit up.
 *  It runs between renders, so it reads the latest page and space from refs. */

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { isAgentEntry, type AgentAction } from "@/shared/core";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useSpaces } from "@/frontend/components/space-context";
import type { LessonPresence } from "./teacher-context";
import { STEP_MS, nextStep } from "./tour";
import { followMoves, followReady, OPEN_SHEET_EVENT, openWaits, safePage, sheetDeadline, type FollowEvent, type FollowState } from "./follow";
import { dialogOpen, highlight, isInView, learnerDialogOpen, pickTarget, sleep, targetElements, waitForTarget } from "./dom";

/** A run of visits waits this long first, so changes made together are
 *  seen together. */
const GATHER_MS = 250;

export function useTour({
	followRef,
	dispatchFollow,
	lessonRef,
	setHeld,
	stepAside,
}: {
	followRef: RefObject<FollowState>;
	dispatchFollow: (e: FollowEvent) => void;
	lessonRef: RefObject<LessonPresence | null>;
	setHeld: (change: AgentAction | null | ((held: AgentAction | null) => AgentAction | null)) => void;
	/** The teacher's panel makes room for the page the tour goes to. */
	stepAside: () => void;
}) {
	const spaces = useSpaces();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const live = useRef({ pathname, spaces, navigate });
	live.current = { pathname, spaces, navigate };
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	const queue = useRef<AgentAction[]>([]);
	// Changes that go to their page whatever Follow says, each with whether
	// the learner clicked for it (an agent's open never jumps a hold).
	const forced = useRef(new Map<string, boolean>());
	const running = useRef(false);
	const holds = useCallback(() => openWaits({ path: live.current.pathname, lessonDraft: !!lessonRef.current?.draft, dialog: learnerDialogOpen() }), [lessonRef]);

	// asked: the learner clicked to go there, so unsent text doesn't hold it.
	// False when the window held it, so there is nothing to light up.
	const showPage = useCallback(
		async (action: AgentAction, asked: boolean): Promise<boolean> => {
			const page = safePage(action.page);
			if (!page) return true;
			const { pathname: path, spaces: space, navigate: nav } = live.current;
			// A move Follow would make waits as Go to while the window holds.
			if (!asked && page !== path && holds()) {
				setHeld(action);
				return false;
			}
			const moves = followMoves({ page, spaceId: action.spaceId }, { path, activeSpace: space.active, lessonDraft: !!lessonRef.current?.draft, asked });
			if (moves.switchSpace) space.setActive(moves.switchSpace.to);
			if (moves.go) {
				nav(moves.go);
				const end = Date.now() + 4000;
				while (live.current.pathname !== moves.go && Date.now() < end && alive.current) await sleep(60);
				await sleep(200);
			}
			return true;
		},
		[holds, lessonRef, setHeld],
	);

	const waitUntilFollowReady = useCallback(async () => {
		while (alive.current && !followReady(followRef.current, dialogOpen(), Date.now())) {
			if (dialogOpen()) dispatchFollow({ type: "busy", at: Date.now() });
			await sleep(250);
		}
	}, [dispatchFollow, followRef]);

	// One change: its page (when following or `go`), then its item lit up.
	const visit = useCallback(
		async (action: AgentAction, go: boolean, asked: boolean) => {
			const following = go || followRef.current.on;
			// The lesson you are reading: the reply is right here.
			if (!go && action.page.startsWith("/chat/") && action.page === live.current.pathname) return;
			if (following && !(await showPage(action, asked))) return;
			const els = await waitForTarget(action.target, following ? 4000 : 1200, () => alive.current);
			const el = pickTarget(els);
			if (el && following && !isInView(el)) {
				el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
				await sleep(prefersReducedMotion() ? 60 : 450);
			}
			for (const e of els) highlight(e);
			await sleep(STEP_MS);
		},
		[showPage, followRef],
	);

	// Many changes at once: the last one's page, every item lit together.
	const burst = useCallback(
		async (actions: AgentAction[]) => {
			const last = actions.at(-1);
			if (followRef.current.on && last) await showPage(last, false);
			await sleep(300);
			for (const e of actions.flatMap((a) => targetElements(a.target))) highlight(e);
			await sleep(STEP_MS * 2);
		},
		[showPage, followRef],
	);

	const run = useCallback(async () => {
		if (running.current) return;
		running.current = true;
		// Changes made together arrive a moment apart: gather them first.
		await sleep(GATHER_MS);
		try {
			for (;;) {
				if (!alive.current) return;
				await waitUntilFollowReady();
				// A click (or an open) jumps the line and goes to its page.
				const [forcedId, asked] = [...forced.current][0] ?? [];
				if (forcedId) {
					forced.current.delete(forcedId);
					const i = queue.current.findIndex((a) => a.id === forcedId);
					const [action] = i >= 0 ? queue.current.splice(i, 1) : [];
					if (action && !asked && holds()) setHeld(action);
					else if (action) await visit(action, true, !!asked);
					continue;
				}
				const step = nextStep(queue.current);
				if (step.step === "done") break;
				if (step.step === "burst") {
					queue.current = [];
					await burst(step.actions);
				} else {
					queue.current = step.rest;
					await visit(step.action, false, false);
				}
			}
		} finally {
			running.current = false;
		}
	}, [burst, visit, waitUntilFollowReady, holds, setHeld]);

	/** A change the agent made: queued for the tour, or held when it opens a page while the window holds. */
	const take = (action: AgentAction) => {
		// The app's and the learner's own entries are listed, never visited, and so are a
		// background check's.
		if (!isAgentEntry(action) || action.background) return;
		if (action.open) {
			// The lesson's own deadline's cheat sheet opens beside the lesson.
			const sheet = sheetDeadline(action.page);
			if (sheet && !window.dispatchEvent(new CustomEvent(OPEN_SHEET_EVENT, { detail: sheet, cancelable: true }))) return stepAside();
			if (holds()) return setHeld(action);
			stepAside();
			setHeld(null);
			forced.current.set(action.id, false);
		}
		queue.current.push(action);
		void run();
	};

	/** The learner's "Go to": that change's page now. */
	const go = useCallback(
		(action: AgentAction) => {
			stepAside();
			setHeld((h) => (h?.id === action.id ? null : h));
			// Not queued twice if it is still waiting.
			queue.current = [...queue.current.filter((a) => a.id !== action.id), action];
			forced.current.set(action.id, true);
			void run();
		},
		[run, stepAside, setHeld],
	);

	return { take, go };
}
