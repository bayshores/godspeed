"use client";

/**
 * The teacher: one provider in the app shell.
 *
 *  - Follow: every "agent-action" event is a change the outside agent
 *    made. With Follow on, the window goes to the change's page and the
 *    changed item (data-halley-target) lights up (tour.ts paces it). On
 *    by default; the learner turns it on and off, and the status line
 *    says what the agent is doing (follow-status.ts).
 *  - The panel: Talk, and Activity (teacher-activity.tsx). It never opens
 *    over a lesson: the lesson's teacher column shows the same Activity.
 *
 * The name is the learner's choice (Settings → General → Teacher name) and
 * only ever shown on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { AgentAction } from "@/shared/core";
import { DEFAULT_TEACHER_NAME, isAgentEntry } from "@/shared/core";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useActivity } from "@/frontend/components/activity-dock";
import { useSpaces } from "@/frontend/components/space-context";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useSettingsSaved } from "@/frontend/components/settings-signal";
import { HalleyPanel } from "./halley-panel";
import { HalleyContext, useHalley, type HalleyApi, type LessonPresence } from "./halley-context";
import { useAskTeacher } from "./ask-teacher";
import type { TalkAsk } from "./talk-view";
import { STEP_MS, nextStep } from "./tour";
import { FOLLOW_DEFAULT, FOLLOW_KEY, GO_OFFER_MS, followMoves, followReady, followReducer, goOffer, parseFollow, safePage, type FollowEvent, type FollowState } from "./follow";
import { agentDoing, freshAction } from "./follow-status";
import { dialogOpen, highlight, isInView, pickTarget, sleep, targetElements, waitForTarget } from "./dom";

/** A run of visits waits this long first, so changes made together are
 *  seen together. */
const GATHER_MS = 250;
const RECENT_LIMIT = 20;

// Most of the app reads the teacher from here.
export { useHalley };

/** A lesson screen reports whether the teacher is writing or working, and
 *  whether the learner has unsent text (Follow then stays on the lesson). */
export function useHalleyLesson(streaming: boolean, working: boolean, draft: boolean): void {
	const api = useHalley();
	const set = api?.setLesson;
	useEffect(() => {
		set?.({ streaming, working, draft });
	}, [set, streaming, working, draft]);
	useEffect(() => () => set?.(null), [set]);
}

function readStored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function writeStored(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* private window: not remembered */
	}
}

export function HalleyProvider({ initialName, children }: { initialName?: string; children: ReactNode }) {
	const [name, setName] = useState(initialName?.trim() || DEFAULT_TEACHER_NAME);
	const agent = useAgentStatus();
	const { feed } = useActivity();
	const spaces = useSpaces();
	const router = useRouter();
	const pathname = usePathname();

	// ── refs the async tour reads (always the latest render's values) ──
	const live = useRef({ name, pathname, spaces, router });
	live.current = { name, pathname, spaces, router };
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	// ── the name (Settings → General) ──
	useSettingsSaved((section) => {
		if (section !== "general") return;
		fetch("/api/settings", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { settings?: { general?: { teacherName?: string } } } | null) => {
				if (body) setName(body.settings?.general?.teacherName?.trim() || DEFAULT_TEACHER_NAME);
			})
			.catch(() => {});
	});

	// ── Follow ──
	const followRef = useRef<FollowState>(FOLLOW_DEFAULT);
	const [followOn, setFollowOn] = useState(FOLLOW_DEFAULT.on);
	const dispatchFollow = useCallback((e: FollowEvent) => {
		const next = followReducer(followRef.current, e);
		followRef.current = next;
		setFollowOn(next.on);
	}, []);
	useEffect(() => {
		if (!parseFollow(readStored(FOLLOW_KEY))) dispatchFollow({ type: "toggle", on: false });
	}, [dispatchFollow]);
	const setFollow = useCallback(
		(on: boolean) => {
			writeStored(FOLLOW_KEY, on ? "1" : "0");
			dispatchFollow({ type: "toggle", on });
		},
		[dispatchFollow],
	);
	// While Follow is on, note when the learner types or has a dialog open.
	useEffect(() => {
		if (!followOn) return;
		const busy = () => dispatchFollow({ type: "busy", at: Date.now() });
		document.addEventListener("input", busy, true);
		const t = setInterval(() => {
			if (dialogOpen()) busy();
		}, 250);
		return () => {
			document.removeEventListener("input", busy, true);
			clearInterval(t);
		};
	}, [followOn, dispatchFollow]);

	// ── the lesson screen ──
	const [lesson, setLessonState] = useState<LessonPresence | null>(null);
	const setLesson = useCallback((p: LessonPresence | null) => {
		setLessonState((prev) => (prev === p || (prev && p && prev.streaming === p.streaming && prev.working === p.working && prev.draft === p.draft) ? prev : p));
	}, []);
	const lessonRef = useRef(lesson);
	lessonRef.current = lesson;

	// ── recent changes ──
	const [recent, setRecent] = useState<AgentAction[]>([]);
	const loadRecent = useCallback(() => {
		fetch("/api/agent-actions", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { actions?: AgentAction[] } | null) => {
				if (Array.isArray(body?.actions)) setRecent(body.actions.slice(0, RECENT_LIMIT));
			})
			.catch(() => {});
	}, []);
	useEffect(loadRecent, [loadRecent]);
	useServerResync(loadRecent);

	// The agent's newest change, while it is fresh.
	const [fresh, setFresh] = useState<AgentAction | null>(null);
	useEffect(() => {
		const now = freshAction(recent, Date.now());
		setFresh(now?.action ?? null);
		if (!now) return;
		const t = setTimeout(() => setFresh(null), now.leftMs);
		return () => clearTimeout(t);
	}, [recent]);

	// "Go to": with Follow off, the newest change on another page.
	const [offer, setOffer] = useState<AgentAction | null>(null);
	useEffect(() => {
		const latest = recent[0];
		const next = goOffer(latest, { follow: followOn, path: pathname, now: Date.now() });
		setOffer(next);
		if (!next) return;
		const t = setTimeout(() => setOffer(null), GO_OFFER_MS - (Date.now() - Date.parse(next.at)));
		return () => clearTimeout(t);
	}, [recent, followOn, pathname]);

	// ── what it's doing ──
	const doing = useMemo(
		() => agentDoing({ agent, fresh, lesson, extractions: feed.extractions, jobs: feed.jobs }),
		[agent, fresh, lesson, feed.extractions, feed.jobs],
	);

	// ── the panel ──
	const [panelOpen, setPanelOpen] = useState(false);
	// A message asked from elsewhere (askTeacher), until Talk sends it.
	const [ask, setAsk] = useState<TalkAsk | null>(null);
	const askCount = useRef(0);
	useAskTeacher((text) => {
		setAsk({ id: ++askCount.current, text });
		setPanelOpen(true);
	});
	const onAsked = useCallback((id: number) => setAsk((a) => (a?.id === id ? null : a)), []);

	// ── the tour ──
	const queue = useRef<AgentAction[]>([]);
	const forced = useRef(new Set<string>());
	const running = useRef(false);

	// asked: the learner clicked to go there, so unsent text doesn't hold it.
	const showPage = useCallback(async (action: AgentAction, asked: boolean) => {
		const page = safePage(action.page);
		if (!page) return;
		const { pathname: path, spaces: space, router: r } = live.current;
		const moves = followMoves({ page, spaceId: action.spaceId }, { path, activeSpace: space.active, lessonDraft: !!lessonRef.current?.draft, asked });
		if (moves.switchSpace) space.setActive(moves.switchSpace.to);
		if (moves.go) {
			r.push(moves.go);
			const end = Date.now() + 4000;
			while (live.current.pathname !== moves.go && Date.now() < end && alive.current) await sleep(60);
			await sleep(200);
		}
	}, []);

	const waitUntilFollowReady = useCallback(async () => {
		while (alive.current && !followReady(followRef.current, dialogOpen(), Date.now())) {
			if (dialogOpen()) dispatchFollow({ type: "busy", at: Date.now() });
			await sleep(250);
		}
	}, [dispatchFollow]);

	// One change: its page (when following), then its item lit up.
	const visit = useCallback(
		async (action: AgentAction, go: boolean) => {
			const following = go || followRef.current.on;
			// The lesson you are reading: the reply is right here.
			if (!go && action.page.startsWith("/chat/") && action.page === live.current.pathname) return;
			if (following) await showPage(action, go);
			const els = await waitForTarget(action.target, following ? 4000 : 1200, () => alive.current);
			const el = pickTarget(els);
			if (el && following && !isInView(el)) {
				el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
				await sleep(prefersReducedMotion() ? 60 : 450);
			}
			for (const e of els) highlight(e);
			await sleep(STEP_MS);
		},
		[showPage],
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
		[showPage],
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
				// A Recent click (or a lesson the learner asked for) jumps the line and
				// always goes to its page.
				const forcedId = [...forced.current][0];
				if (forcedId) {
					forced.current.delete(forcedId);
					const i = queue.current.findIndex((a) => a.id === forcedId);
					const [action] = i >= 0 ? queue.current.splice(i, 1) : [];
					if (action) await visit(action, true);
					continue;
				}
				const step = nextStep(queue.current);
				if (step.step === "done") break;
				if (step.step === "burst") {
					queue.current = [];
					await burst(step.actions);
				} else {
					queue.current = step.rest;
					await visit(step.action, false);
				}
			}
		} finally {
			running.current = false;
		}
	}, [burst, visit, waitUntilFollowReady]);

	useServerEvent("agent-action", (action) => {
		if (!action || typeof action.id !== "string") return;
		setRecent((list) => [action, ...list.filter((a) => a.id !== action.id)].slice(0, RECENT_LIMIT));
		// The app's and the learner's own entries are listed, never visited.
		if (!isAgentEntry(action)) return;
		queue.current.push(action);
		if (action.open) forced.current.add(action.id);
		void run();
	});

	const go = useCallback(
		(action: AgentAction) => {
			setPanelOpen(false);
			// Not queued twice if it is still waiting.
			queue.current = [...queue.current.filter((a) => a.id !== action.id), action];
			forced.current.add(action.id);
			void run();
		},
		[run],
	);

	// A lesson has its own teacher column: the panel shuts when one opens.
	const inLesson = lesson !== null;
	useEffect(() => {
		if (inLesson) setPanelOpen(false);
	}, [inLesson]);

	const spaceList = spaces.spaces;
	const spaceNameOf = useCallback((id: string | null) => (id ? (spaceList.find((c) => c.id === id)?.name ?? null) : null), [spaceList]);

	const api = useMemo<HalleyApi>(
		() => ({ name, follow: followOn, setFollow, panelOpen, setPanelOpen, recent, doing, setLesson, go, offer, spaceNameOf }),
		[name, followOn, setFollow, panelOpen, recent, doing, setLesson, go, offer, spaceNameOf],
	);

	return (
		<HalleyContext.Provider value={api}>
			{children}
			{panelOpen && !inLesson && (
				<PanelPortal>
					<HalleyPanel name={name} agent={agent} onClose={() => setPanelOpen(false)} recent={recent} onPick={go} ask={ask} onAsked={onAsked} />
				</PanelPortal>
			)}
		</HalleyContext.Provider>
	);
}

/** The open panel, on the page's top layer. It closes on a click elsewhere
 *  and on Esc, except while a dialog opened from it is up. */
function PanelPortal({ children }: { children: ReactNode }) {
	const api = useHalley();
	const close = api?.setPanelOpen;
	useEffect(() => {
		if (!close) return;
		const dialogUp = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');
		const onDown = (e: PointerEvent) => {
			if (dialogUp()) return;
			const t = e.target;
			if (t instanceof Element && t.closest("[data-halley-panel], [data-halley-panel-toggle]")) return;
			close(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !dialogUp()) {
				e.stopPropagation();
				close(false);
			}
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [close]);
	return createPortal(children, document.body);
}
