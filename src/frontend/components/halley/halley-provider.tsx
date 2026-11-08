"use client";

/**
 * The teacher: one provider in the app shell.
 *
 *  - Mood: follows the app (mood.ts); the mascot shows it wherever it is
 *    drawn (teacher-sprite.tsx).
 *  - Follow: every "agent-action" event is a change the outside agent
 *    made. With Follow on, the window goes to the change's page and the
 *    changed item (data-halley-target) lights up (tour.ts paces it). On
 *    by default; the learner turns it on and off, and the status line
 *    says what the agent is doing (follow-status.ts).
 *  - The panel: Talk, and Activity (Now, Recent, Background jobs).
 *
 * The name is the learner's choice (Settings → General → Teacher name) and
 * only ever shown on screen.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { AgentAction } from "@/shared/core";
import { DEFAULT_TEACHER_NAME, isAgentEntry } from "@/shared/core";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useActivity } from "@/frontend/components/activity-dock";
import { useClasses } from "@/frontend/components/class-context";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useSettingsSaved } from "@/frontend/components/settings-signal";
import { HalleyPanel } from "./halley-panel";
import { useAskTeacher } from "./ask-teacher";
import type { TalkAsk } from "./talk-view";
import { REACTION_MS, crossedUnderHour, pickMood, type HalleyMood, type HalleyReaction } from "./mood";
import { STEP_MS, nextStep } from "./tour";
import { FOLLOW_DEFAULT, FOLLOW_KEY, GO_OFFER_MS, followMoves, followReady, followReducer, goOffer, parseFollow, safePage, type FollowEvent, type FollowState } from "./follow";
import { agentDoing, freshAction, type AgentDoing } from "./follow-status";
import { dialogOpen, highlight, isInView, pickTarget, sleep, targetElements, waitForTarget } from "./dom";

/** A run of visits waits this long first, so changes made together are
 *  seen together. */
const GATHER_MS = 250;
const RECENT_LIMIT = 20;

interface LessonPresence {
	/** A teacher message is being written. */
	streaming: boolean;
	/** A turn is in flight. */
	working: boolean;
	/** The learner has unsent text here: Follow stays on this lesson. */
	draft: boolean;
}

interface HalleyApi {
	name: string;
	mood: HalleyMood;
	follow: boolean;
	setFollow: (on: boolean) => void;
	panelOpen: boolean;
	setPanelOpen: (open: boolean) => void;
	/** Newest first. */
	recent: AgentAction[];
	/** What the agent is doing now; null while no agent is connected. */
	doing: AgentDoing | null;
	/** A brief mood (a graded answer). */
	react: (r: HalleyReaction) => void;
	/** A lesson screen reports itself (null when it leaves). */
	setLesson: (p: LessonPresence | null) => void;
	/** Go to a change (a Recent row): its page, then fly to it. */
	go: (action: AgentAction) => void;
	/** With Follow off: a fresh change on another page, to offer "Go to". */
	offer: AgentAction | null;
}

const HalleyContext = createContext<HalleyApi | null>(null);

/** Halley's state; null outside the app shell (render tests, onboarding). */
export function useHalley(): HalleyApi | null {
	return useContext(HalleyContext);
}

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
	const classes = useClasses();
	const due = useOpenDeadlines();
	const router = useRouter();
	const pathname = usePathname();

	// ── refs the async tour reads (always the latest render's values) ──
	const live = useRef({ name, pathname, classes, router });
	live.current = { name, pathname, classes, router };
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

	// ── reactions (brief moods) ──
	const [reaction, setReaction] = useState<HalleyReaction | null>(null);
	const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const react = useCallback((r: HalleyReaction) => {
		setReaction(r);
		if (reactionTimer.current) clearTimeout(reactionTimer.current);
		reactionTimer.current = setTimeout(() => setReaction(null), REACTION_MS[r]);
	}, []);
	useEffect(() => () => clearTimeout(reactionTimer.current), []);

	// A job failed (one that wasn't failed when the window opened): @_@.
	const seenFailed = useRef<Set<string> | null>(null);
	useEffect(() => {
		const failed = feed.failed;
		if (!failed) return;
		if (seenFailed.current === null) {
			seenFailed.current = new Set(failed.map((f) => f.id));
			return;
		}
		const fresh = failed.filter((f) => !seenFailed.current!.has(f.id));
		for (const f of fresh) seenFailed.current.add(f.id);
		if (fresh.length) react("dizzy");
	}, [feed.failed, react]);

	// A deadline crossed under one hour left: O_O.
	const dueRef = useRef(due.deadlines);
	dueRef.current = due.deadlines;
	useEffect(() => {
		let prev = Date.now();
		const t = setInterval(() => {
			const now = Date.now();
			const list = (dueRef.current ?? []).map((d) => ({ id: d.id, dueMs: dueAtMs(d) }));
			if (crossedUnderHour(list, prev, now).length) react("shocked");
			prev = now;
		}, 15_000);
		return () => clearInterval(t);
	}, [react]);

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

	// ── what it's doing, and the mood ──
	const doing = useMemo(
		() => agentDoing({ agent, fresh, lesson, extractions: feed.extractions, jobs: feed.jobs }),
		[agent, fresh, lesson, feed.extractions, feed.jobs],
	);
	const mood = pickMood({ reaction, streaming: !!lesson?.streaming, working: !!doing?.working, connected: agent ? agent.connected : null });

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
		const { pathname: path, classes: cls, router: r } = live.current;
		const moves = followMoves({ page, classId: action.classId }, { path, activeClass: cls.active, lessonDraft: !asked && !!lessonRef.current?.draft });
		if (moves.switchClass) cls.setActive(moves.switchClass.to);
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

	const api = useMemo<HalleyApi>(
		() => ({ name, mood, follow: followOn, setFollow, panelOpen, setPanelOpen, recent, doing, react, setLesson, go, offer }),
		[name, mood, followOn, setFollow, panelOpen, recent, doing, react, setLesson, go, offer],
	);

	const classList = classes.classes;
	const classNameOf = useCallback((id: string | null) => (id ? (classList.find((c) => c.id === id)?.name ?? null) : null), [classList]);

	return (
		<HalleyContext.Provider value={api}>
			{children}
			{panelOpen && (
				<PanelPortal>
					<HalleyPanel
						name={name}
						agent={agent}
						onClose={() => setPanelOpen(false)}
						doing={doing}
						recent={recent}
						onPick={go}
						classNameOf={classNameOf}
						ask={ask}
						onAsked={onAsked}
					/>
				</PanelPortal>
			)}
		</HalleyContext.Provider>
	);
}

/** The open panel, on the page's top layer. It closes on a click elsewhere
 *  and on Esc. */
function PanelPortal({ children }: { children: ReactNode }) {
	const api = useHalley();
	const close = api?.setPanelOpen;
	useEffect(() => {
		if (!close) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target;
			if (t instanceof Element && t.closest("[data-halley-panel], [data-halley-panel-toggle]")) return;
			close(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
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
