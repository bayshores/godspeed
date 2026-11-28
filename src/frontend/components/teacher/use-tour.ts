/** The tour: the agent's changes visited one by one, each on its page (when
 *  following, or when the learner or the agent asked) with its item lit up.
 *  It runs between renders, so it reads the latest page and space from refs.
 *  What it lit stays lit (lit-model.ts), and while Follow waits it says why. */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { isAgentEntry, type AgentAction } from "@/shared/core";
import { FAST_MS, prefersReducedMotion } from "@/frontend/components/presence";
import { useSpaces } from "@/frontend/components/space-context";
import type { LessonPresence } from "./teacher-context";
import { STEP_MS, nextStep, targetKey } from "./tour";
import { followMoves, followPause, OPEN_SHEET_EVENT, openWaits, safePage, sheetDeadline, type FollowEvent, type FollowPause, type FollowState } from "./follow";
import { dialogOpen, isInView, learnerDialogOpen, pickTarget, sleep, targetElements, waitForTarget } from "./dom";
import { dropLeft, letGo, lightUp, type Lit } from "./lit-model";

/** Follow waits, and why; `waiting` is the change it waits to show on another page. */
export interface TourPause {
	why: FollowPause;
	waiting: AgentAction | null;
}

/** The lit marks: lighting keys on the page shown, and letting marks go (they fade, then leave). */
function useLit(pathname: string) {
	const [lit, setLit] = useState<Lit>(new Map());
	const light = useCallback((keys: string[], page: string) => setLit((l) => lightUp(l, keys, page)), []);
	const release = useCallback((keep: Parameters<typeof letGo>[1]) => setLit((l) => letGo(l, keep)), []);
	// Another page: the marks lit elsewhere go.
	useEffect(() => release((_, mark) => mark.page === pathname), [pathname, release]);
	const leaving = [...lit.values()].some((m) => m.leaving);
	useEffect(() => {
		if (!leaving) return;
		const t = setTimeout(() => setLit(dropLeft), prefersReducedMotion() ? 0 : FAST_MS);
		return () => clearTimeout(t);
	}, [leaving, lit]);
	// The pointer over a lit thing lets its mark go: one listener for the page.
	const any = [...lit.values()].some((m) => !m.leaving);
	useEffect(() => {
		if (!any) return;
		const over = (e: PointerEvent) => {
			const key = e.target instanceof Element ? e.target.closest("[data-teacher-target]")?.getAttribute("data-teacher-target") : null;
			if (key) release((k) => k !== key);
		};
		document.addEventListener("pointerover", over);
		return () => document.removeEventListener("pointerover", over);
	}, [any, release]);
	return { lit, light, release };
}

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

	const { lit, light, release } = useLit(pathname);
	const [pause, setPause] = useState<TourPause | null>(null);

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

	// The learner clicked to go to a change: it goes at once, whatever Follow waits for.
	const clicked = useCallback(() => [...forced.current.values()].some(Boolean), []);
	const waitUntilFollowReady = useCallback(async () => {
		for (;;) {
			const dialog = dialogOpen();
			const why = followPause(followRef.current, dialog, Date.now());
			if (!alive.current || why === null || clicked()) break;
			if (dialog) dispatchFollow({ type: "busy", at: Date.now(), why: "dialog" });
			const here = live.current.pathname;
			const waiting = queue.current.find((a) => safePage(a.page) !== null && a.page !== here) ?? null;
			setPause((p) => (p?.why === why && p.waiting === waiting ? p : { why, waiting }));
			await sleep(250);
		}
		setPause(null);
	}, [dispatchFollow, followRef, clicked]);

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
			if (els.length > 0 && action.target) light([targetKey(action.target)], live.current.pathname);
			await sleep(STEP_MS);
		},
		[showPage, followRef, light],
	);

	// Many changes at once: the last one's page, every item lit together.
	const burst = useCallback(
		async (actions: AgentAction[]) => {
			const last = actions.at(-1);
			if (followRef.current.on && last) await showPage(last, false);
			await sleep(300);
			const shown = actions.flatMap((a) => (a.target && targetElements(a.target).length > 0 ? [targetKey(a.target)] : []));
			light(shown, live.current.pathname);
			await sleep(STEP_MS * 2);
		},
		[showPage, followRef, light],
	);

	const run = useCallback(async () => {
		if (running.current) return;
		running.current = true;
		// Changes made together arrive a moment apart: gather them first.
		await sleep(GATHER_MS);
		try {
			for (;;) {
				if (!alive.current || (queue.current.length === 0 && forced.current.size === 0)) break;
				await waitUntilFollowReady();
				// A click (or an open) jumps the line and goes to its page; a click first.
				const [forcedId, asked] = [...forced.current].find(([, byLearner]) => byLearner) ?? [...forced.current][0] ?? [];
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

	/** A new round of work: every mark goes. */
	const clearLit = useCallback(() => release(() => false), [release]);

	return { take, go, pause, lit, clearLit };
}
