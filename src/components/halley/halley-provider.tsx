"use client";

/**
 * HALLEY: the logo's comet as the on-screen
 * teacher. One provider in the app shell:
 *
 *  - Presence: it peeks over the bottom edge of the content area (the
 *    reading pane in a lesson), bottom-right by default and draggable to
 *    bottom-left. It rises out of the edge on hover, with its bubble, and
 *    with the panel open. Its mood follows the app (mood.ts).
 *  - Changes: every "agent-action" event is a change the outside agent
 *    made. Halley flies to the changed element (data-halley-target), the
 *    element glows, and the bubble says what happened (tour.ts paces it).
 *  - Follow: when on, it also takes the window to the change's page
 *    (follow.ts), and stops when you go somewhere yourself.
 *  - The panel (click Halley, or the sidebar's agent line): Now, Recent,
 *    Background jobs, and the Follow switch.
 *
 * The name is the learner's choice (Settings → General → Teacher name) and
 * only ever shown on screen.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import type { AgentAction } from "@/core";
import { DEFAULT_TEACHER_NAME } from "@/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { useAgentStatus } from "@/components/agent-status";
import { useActivity } from "@/components/activity-dock";
import { useClasses } from "@/components/class-context";
import { useOpenDeadlines } from "@/components/use-open-deadlines";
import { dueAtMs } from "@/components/countdown-model";
import { prefersReducedMotion } from "@/components/presence";
import { useSettingsSaved } from "@/components/settings-signal";
import { cn } from "@/lib/utils";
import { HalleyFace } from "./halley-face";
import { HalleyPanel } from "./halley-panel";
import { HalleyEngine, type Home } from "./engine";
import { REACTION_MS, crossedUnderHour, eyesStill, pickMood, type HalleyMood, type HalleyReaction } from "./mood";
import { BURST_MS, FLY_MS, STEP_MS, bubbleText, nextStep, summarize } from "./tour";
import { FOLLOW_KEY, FOLLOW_OFF, GO_OFFER_MS, NOTICE_MS, followMoves, followReady, followReducer, goOffer, parseFollow, safePage, type FollowEvent, type FollowState } from "./follow";
import {
	CORNER_KEY,
	NARROW_WIDTH,
	SIZE,
	besideTarget,
	clearOf,
	cornerSpot,
	edgeToward,
	parseCorner,
	unionBox,
	type Box,
	type Corner,
} from "./geometry";
import {
	REMOVE_FADE_MS,
	boxOf,
	dialogOpen,
	fadeOut,
	glow,
	isInView,
	pickTarget,
	placeGhost,
	sleep,
	snapshot,
	targetElements,
	viewportBox,
	visibleRegion,
	waitForTarget,
	type Ghost,
} from "./dom";

/** The latest change counts as "what it's doing now" this long. */
const NOW_WINDOW_MS = 20_000;
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
	/** "Stopped following", briefly. */
	notice: string | null;
	panelOpen: boolean;
	setPanelOpen: (open: boolean) => void;
	/** Newest first. */
	recent: AgentAction[];
	/** What the agent is doing now (the latest change, while fresh). */
	nowText: string | null;
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

/** A lesson screen: Halley rests in the reading pane and talks while the
 *  teacher writes. */
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
	const followRef = useRef<FollowState>(FOLLOW_OFF);
	const [followView, setFollowView] = useState<{ on: boolean; notice: string | null }>({ on: false, notice: null });
	const dispatchFollow = useCallback((e: FollowEvent) => {
		const next = followReducer(followRef.current, e);
		followRef.current = next;
		setFollowView((v) => (v.on === next.on && v.notice === next.notice ? v : { on: next.on, notice: next.notice }));
	}, []);
	useEffect(() => {
		if (parseFollow(readStored(FOLLOW_KEY))) dispatchFollow({ type: "toggle", on: true });
	}, [dispatchFollow]);
	const setFollow = useCallback(
		(on: boolean) => {
			writeStored(FOLLOW_KEY, on ? "1" : "0");
			dispatchFollow({ type: "toggle", on });
		},
		[dispatchFollow],
	);
	// Going somewhere yourself stops Follow (its own navigations are expected).
	const prevPath = useRef(pathname);
	useEffect(() => {
		if (prevPath.current === pathname) return;
		prevPath.current = pathname;
		const wasOn = followRef.current.on;
		dispatchFollow({ type: "route", path: pathname });
		if (wasOn && !followRef.current.on) writeStored(FOLLOW_KEY, "0");
	}, [pathname, dispatchFollow]);
	useEffect(() => {
		if (!followView.notice) return;
		const t = setTimeout(() => dispatchFollow({ type: "clear-notice" }), NOTICE_MS);
		return () => clearTimeout(t);
	}, [followView.notice, dispatchFollow]);
	// While Follow is on, note when the learner types or has a dialog open.
	useEffect(() => {
		if (!followView.on) return;
		const busy = () => dispatchFollow({ type: "busy", at: Date.now() });
		document.addEventListener("input", busy, true);
		const t = setInterval(() => {
			if (dialogOpen()) busy();
		}, 250);
		return () => {
			document.removeEventListener("input", busy, true);
			clearInterval(t);
		};
	}, [followView.on, dispatchFollow]);

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

	// "Now": the newest change, while it is fresh.
	const [nowText, setNowText] = useState<string | null>(null);
	useEffect(() => {
		const latest = recent[0];
		if (!latest) return setNowText(null);
		const left = NOW_WINDOW_MS - (Date.now() - Date.parse(latest.at));
		if (left <= 0) return setNowText(null);
		setNowText(latest.label);
		const t = setTimeout(() => setNowText(null), left);
		return () => clearTimeout(t);
	}, [recent]);

	// "Go to": with Follow off, the newest change on another page.
	const [offer, setOffer] = useState<AgentAction | null>(null);
	useEffect(() => {
		const latest = recent[0];
		const next = goOffer(latest, { follow: followView.on, path: pathname, now: Date.now() });
		setOffer(next);
		if (!next) return;
		const t = setTimeout(() => setOffer(null), GO_OFFER_MS - (Date.now() - Date.parse(next.at)));
		return () => clearTimeout(t);
	}, [recent, followView.on, pathname]);

	// ── the mood ──
	const jobs = feed.jobs.length + feed.extractions.length;
	const working = !!agent && (agent.pendingWork > 0 || jobs > 0 || !!lesson?.working);
	const mood = pickMood({ reaction, streaming: !!lesson?.streaming, working, connected: agent ? agent.connected : null });
	const moodRef = useRef(mood);
	moodRef.current = mood;

	// ── the panel ──
	const [panelOpen, setPanelOpen] = useState(false);

	// ── the stage (engine) ──
	const engineRef = useRef<HalleyEngine | null>(null);
	const [tourBubble, setTourBubble] = useState<string | null>(null);

	// ── the tour ──
	const queue = useRef<AgentAction[]>([]);
	const forced = useRef(new Set<string>());
	const ghosts = useRef(new Map<string, Ghost>());
	const running = useRef(false);

	// asked: the learner clicked to go there, so unsent text doesn't hold it.
	const showPage = useCallback(async (action: AgentAction, asked: boolean) => {
		const page = safePage(action.page);
		if (!page) return;
		const { pathname: path, classes: cls, router: r } = live.current;
		const moves = followMoves({ page, classId: action.classId }, { path, activeClass: cls.active, lessonDraft: !asked && !!lessonRef.current?.draft });
		if (moves.switchClass) cls.setActive(moves.switchClass.to);
		if (moves.go) {
			dispatchFollow({ type: "navigating", path: moves.go });
			r.push(moves.go);
			const end = Date.now() + 4000;
			while (live.current.pathname !== moves.go && Date.now() < end && alive.current) await sleep(60);
			await sleep(200);
		}
	}, [dispatchFollow]);

	const waitUntilFollowReady = useCallback(async () => {
		while (alive.current && !followReady(followRef.current, dialogOpen(), Date.now())) {
			if (dialogOpen()) dispatchFollow({ type: "busy", at: Date.now() });
			await sleep(250);
		}
	}, [dispatchFollow]);

	const visit = useCallback(
		async (action: AgentAction, go: boolean) => {
			const engine = engineRef.current;
			if (!engine) return;
			const reduce = prefersReducedMotion();
			const following = go || followRef.current.on;
			// The lesson you are reading: the reply is right here.
			if (!go && action.page.startsWith("/chat/") && action.page === live.current.pathname) return;
			if (following) await showPage(action, go);
			const ghost = ghosts.current.get(action.id);
			ghosts.current.delete(action.id);
			let els = await waitForTarget(action.target, following ? 4000 : action.removed || ghost ? 0 : 1200, () => alive.current);
			setTourBubble(action.label);
			// Gone already (removed, or ticked done and dropped from the list):
			// visit its copy, which then fades out.
			let ghostEl: HTMLElement | null = null;
			if (!els.length && ghost) {
				ghostEl = placeGhost(ghost);
				els = [ghostEl];
			}
			const el = pickTarget(els);
			if (!el) {
				engine.goHome();
				await sleep(STEP_MS * 2);
				return;
			}
			if (following && !isInView(el)) {
				el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
				await sleep(reduce ? 60 : 450);
			}
			const size = engine.box().width;
			if (isInView(el)) {
				engine.pointAt(null);
				// Aim at the element as it is each frame: a list may re-sort
				// while Halley is on its way.
				let aim = besideTarget(boxOf(el.getBoundingClientRect()), size, { width: window.innerWidth, height: window.innerHeight });
				engine.flyTo(() => {
					if (el.isConnected) aim = besideTarget(boxOf(el.getBoundingClientRect()), size, { width: window.innerWidth, height: window.innerHeight });
					return aim;
				});
			} else {
				const { at, dir } = edgeToward(boxOf(el.getBoundingClientRect()), visibleRegion(el), size);
				engine.flyTo(at);
				engine.pointAt(dir);
			}
			await sleep(reduce ? 120 : FLY_MS);
			for (const e of els) glow(e, reduce);
			await sleep(STEP_MS - FLY_MS);
			if (action.removed || ghostEl) {
				for (const e of els) fadeOut(e, reduce, e === ghostEl ? () => e.remove() : undefined);
				await sleep(REMOVE_FADE_MS);
			}
		},
		[showPage],
	);

	const burst = useCallback(
		async (actions: AgentAction[], summary: string) => {
			const engine = engineRef.current;
			if (!engine) return;
			const reduce = prefersReducedMotion();
			const last = actions.at(-1);
			if (followRef.current.on && last) await showPage(last, false);
			for (const a of actions) ghosts.current.delete(a.id);
			await sleep(300);
			setTourBubble(summary);
			const els = actions.flatMap((a) => targetElements(a.target));
			const seen = els.filter((e) => isInView(e)).map((e) => boxOf(e.getBoundingClientRect()));
			const around = unionBox(seen);
			if (around) {
				engine.pointAt(null);
				engine.flyTo(besideTarget(around, engine.box().width, { width: window.innerWidth, height: window.innerHeight }));
			}
			for (const e of els) glow(e, reduce);
			await sleep(BURST_MS);
		},
		[showPage],
	);

	const run = useCallback(async () => {
		if (running.current) return;
		running.current = true;
		// Changes made together arrive a moment apart: gather them first.
		await sleep(GATHER_MS);
		const done: AgentAction[] = [];
		try {
			for (;;) {
				for (;;) {
					if (!alive.current) return;
					await waitUntilFollowReady();
					const names = (id: string) => live.current.classes.classes.find((c) => c.id === id)?.name;
					// A Recent click jumps the line and always goes to its page.
					const forcedId = [...forced.current][0];
					if (forcedId) {
						forced.current.delete(forcedId);
						const i = queue.current.findIndex((a) => a.id === forcedId);
						const [action] = i >= 0 ? queue.current.splice(i, 1) : [];
						if (action) await visit(action, true);
						continue;
					}
					const step = nextStep(queue.current, names);
					if (step.step === "done") break;
					if (step.step === "burst") {
						queue.current = [];
						// The summary counts this run's earlier visits too ("Added 8").
						const all = [...done, ...step.actions];
						done.push(...step.actions);
						await burst(step.actions, summarize(all, names));
					} else {
						queue.current = step.rest;
						done.push(step.action);
						await visit(step.action, false);
					}
				}
				engineRef.current?.pointAt(null);
				engineRef.current?.goHome();
				await sleep(500);
				// A change or Recent click that came in on the way home is visited
				// now: its own run() returned early while this one held the lock.
				if (alive.current && (queue.current.length > 0 || forced.current.size > 0)) continue;
				setTourBubble(null);
				break;
			}
		} finally {
			running.current = false;
		}
	}, [burst, visit, waitUntilFollowReady]);

	useServerEvent("agent-action", (action) => {
		if (!action || typeof action.id !== "string") return;
		setRecent((list) => [action, ...list.filter((a) => a.id !== action.id)].slice(0, RECENT_LIMIT));
		// Keep a copy of the item now, in case the page drops it before the
		// visit (removed, or done and gone from the list).
		if (action.target) {
			const el = pickTarget(targetElements(action.target));
			if (el) ghosts.current.set(action.id, snapshot(el));
		}
		queue.current.push(action);
		void run();
	});

	const go = useCallback(
		(action: AgentAction) => {
			setPanelOpen(false);
			queue.current.push(action);
			forced.current.add(action.id);
			void run();
		},
		[run],
	);

	const api = useMemo<HalleyApi>(
		() => ({ name, mood, follow: followView.on, setFollow, notice: followView.notice, panelOpen, setPanelOpen, recent, nowText, react, setLesson, go, offer }),
		[name, mood, followView.on, followView.notice, setFollow, panelOpen, recent, nowText, react, setLesson, go, offer],
	);

	const inLesson = pathname.startsWith("/chat/") && lesson !== null;
	const classList = classes.classes;
	const classNameOf = useCallback((id: string | null) => (id ? (classList.find((c) => c.id === id)?.name ?? null) : null), [classList]);
	const bubble = tourBubble ?? (inLesson ? null : nowText);

	return (
		<HalleyContext.Provider value={api}>
			{children}
			<HalleyStage
				engineRef={engineRef}
				name={name}
				mood={mood}
				moodRef={moodRef}
				bubble={bubble}
				inLesson={inLesson}
				panelOpen={panelOpen}
				setPanelOpen={setPanelOpen}
				agent={agent}
				follow={followView.on}
				setFollow={setFollow}
				recent={recent}
				nowText={nowText}
				go={go}
				classNameOf={classNameOf}
			/>
		</HalleyContext.Provider>
	);
}

// ─── the stage ──────────────────────────────────────────────────────────────

function HalleyStage({
	engineRef,
	name,
	mood,
	moodRef,
	bubble,
	inLesson,
	panelOpen,
	setPanelOpen,
	agent,
	follow,
	setFollow,
	recent,
	nowText,
	go,
	classNameOf,
}: {
	engineRef: React.RefObject<HalleyEngine | null>;
	name: string;
	mood: HalleyMood;
	moodRef: React.RefObject<HalleyMood>;
	bubble: string | null;
	inLesson: boolean;
	panelOpen: boolean;
	setPanelOpen: (open: boolean) => void;
	agent: ReturnType<typeof useAgentStatus>;
	follow: boolean;
	setFollow: (on: boolean) => void;
	recent: AgentAction[];
	nowText: string | null;
	go: (action: AgentAction) => void;
	classNameOf: (id: string | null) => string | null;
}) {
	const [mounted, setMounted] = useState(false);
	const rootRef = useRef<HTMLButtonElement>(null);
	const lookRef = useRef<SVGGElement>(null);
	const bubbleRef = useRef<HTMLDivElement>(null);
	const trailRef = useRef<SVGPathElement>(null);
	const gradRef = useRef<SVGLinearGradientElement>(null);
	const [corner, setCorner] = useState<Corner>("br");
	const cornerRef = useRef(corner);
	cornerRef.current = corner;
	const [narrow, setNarrow] = useState(false);
	const inLessonRef = useRef(inLesson);
	inLessonRef.current = inLesson;

	useEffect(() => {
		setCorner(parseCorner(readStored(CORNER_KEY)));
		setMounted(true);
	}, []);

	const liftedRef = useRef(false);
	liftedRef.current = !!bubble || panelOpen;

	// The content area, or the reading pane in a lesson (clear of the
	// Submit answer bar).
	const area = useCallback((): Box => {
		const el = (inLessonRef.current && document.querySelector("[data-halley-area]")) || document.querySelector("main");
		return el ? boxOf(el.getBoundingClientRect()) : viewportBox();
	}, []);

	const home = useCallback((): Home => {
		const a = area();
		const banner = document.querySelector<HTMLElement>("[data-testid='update-banner']");
		const obstacle = banner ? boxOf(banner.getBoundingClientRect()) : null;
		const at = (risen: boolean) => clearOf(cornerSpot(cornerRef.current, a, SIZE, risen), SIZE, obstacle);
		return { spot: at(false), up: at(true), size: SIZE, edge: a.top + a.height };
	}, [area]);

	// The engine lives as long as the stage.
	useEffect(() => {
		if (!mounted) return;
		const root = rootRef.current;
		const look = lookRef.current;
		const bubbleEl = bubbleRef.current;
		const trail = trailRef.current;
		const gradient = gradRef.current;
		if (!root || !look || !bubbleEl || !trail || !gradient) return;
		const engine = new HalleyEngine(
			{ root, look, bubble: bubbleEl, trail, gradient },
			{
				home,
				area,
				lifted: () => liftedRef.current,
				reduceMotion: prefersReducedMotion,
				eyesStill: () => eyesStill(moodRef.current),
				onCorner: (c) => {
					writeStored(CORNER_KEY, c);
					cornerRef.current = c;
					setCorner(c);
				},
			},
		);
		engineRef.current = engine;
		const refresh = () => engine.refresh();
		const onResize = () => {
			setNarrow(window.innerWidth < NARROW_WIDTH);
			refresh();
		};
		onResize();
		window.addEventListener("resize", onResize);
		window.addEventListener("scroll", refresh, { capture: true, passive: true });
		const main = document.querySelector("main");
		const ro = new ResizeObserver(refresh);
		if (main) ro.observe(main);
		// The update banner comes and goes.
		const mo = new MutationObserver(refresh);
		mo.observe(document.body, { childList: true });
		return () => {
			window.removeEventListener("resize", onResize);
			window.removeEventListener("scroll", refresh, { capture: true });
			ro.disconnect();
			mo.disconnect();
			engine.destroy();
			engineRef.current = null;
		};
	}, [mounted, home, area, engineRef, moodRef]);

	useEffect(() => {
		engineRef.current?.refresh();
	}, [inLesson, corner, panelOpen, engineRef]);

	useEffect(() => {
		engineRef.current?.setBubble(!!bubble);
	}, [bubble, narrow, engineRef]);

	// The panel closes on a click elsewhere and on Esc.
	useEffect(() => {
		if (!panelOpen) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target;
			if (t instanceof Element && t.closest("[data-halley-panel], [data-halley-panel-toggle]")) return;
			if (rootRef.current?.contains(t as Node)) return;
			setPanelOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setPanelOpen(false);
			}
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [panelOpen, setPanelOpen]);

	if (!mounted) return null;
	const text = bubble ? bubbleText(name, bubble, narrow) : null;
	return createPortal(
		<>
			<svg aria-hidden className="pointer-events-none fixed inset-0 z-[38] h-screen w-screen">
				<defs>
					<linearGradient ref={gradRef} id="lh-halley-trail" gradientUnits="userSpaceOnUse">
						<stop offset="0" style={{ stopColor: "var(--foreground)" }} stopOpacity="0.7" />
						<stop offset="1" style={{ stopColor: "var(--foreground)" }} stopOpacity="0" />
					</linearGradient>
				</defs>
				<path ref={trailRef} fill="url(#lh-halley-trail)" />
			</svg>
			<button
				ref={rootRef}
				type="button"
				data-testid="halley"
				data-halley-mood={mood}
				aria-label={`${name}. Open the panel`}
				aria-expanded={panelOpen}
				onClick={() => {
					if (engineRef.current?.consumeDragClick()) return;
					setPanelOpen(!panelOpen);
				}}
				className="lh-halley fixed left-0 top-0 z-40 cursor-pointer touch-none select-none border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
				// The engine owns position and size from the first frame on; these
				// never change, so React never writes over it.
				style={{ width: SIZE, height: SIZE, transform: "translate(-200px, -200px)" }}
			>
				{/* A soft dark halo, so the page fades around it instead of it looking cut off. */}
				<span aria-hidden className="hy-halo pointer-events-none absolute -inset-3 rounded-full bg-black blur-[10px]" />
				<HalleyFace mood={mood} lookRef={lookRef} className="relative" />
			</button>
			<div
				ref={bubbleRef}
				role="status"
				data-testid="halley-bubble"
				className={cn(
					"lh-halley-bubble pointer-events-none fixed left-0 top-0 z-40 flex items-center gap-[5px] whitespace-nowrap lh-glass px-2.5 py-1.5 font-ui text-[13px]",
					text ? "opacity-100" : "opacity-0",
				)}
			>
				{text?.who && <b className="font-bold text-ink">{text.who}</b>}
				{text && <span className="text-ink-2">{text.who ? `· ${text.what}` : text.what}</span>}
			</div>
			{panelOpen && (
				<HalleyPanel
					name={name}
					agent={agent}
					follow={follow}
					onFollow={setFollow}
					nowText={nowText}
					recent={recent}
					onPick={go}
					classNameOf={classNameOf}
					anchor={{ spot: home().up, size: SIZE }}
				/>
			)}
		</>,
		document.body,
	);
}
