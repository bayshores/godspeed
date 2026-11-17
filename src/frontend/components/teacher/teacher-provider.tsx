/**
 * The teacher: one provider in the app shell.
 *
 *  - Follow: every "agent-action" event is a change the outside agent
 *    made. With Follow on, the window goes to the change's page and the
 *    changed item (data-teacher-target) lights up (tour.ts paces it). On
 *    by default; the learner turns it on and off, and the status line
 *    says what the agent is doing (follow-status.ts).
 *  - Opens: a change marked `open` (a page the agent opened, a lesson
 *    the learner asked for) goes there with Follow off too. While the
 *    window holds (unsent lesson text, a mock, a dialog) it waits as a
 *    held "Go to" instead; a newer open replaces it.
 *  - The panel (use-teacher-panel.ts): in the desktop app the agent's
 *    screen, where the learner talks to it outside lessons, and Activity
 *    (teacher-activity.tsx); in a browser Activity alone. It stays open
 *    across pages, lessons too.
 *
 * The name is the learner's choice (Settings → General → Teacher name) and
 * only ever shown on screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import type { AgentAction } from "@/shared/core";
import { DEFAULT_TEACHER_NAME, isAgentEntry } from "@/shared/core";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { useDoneSound } from "./use-done-sound";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useActivity } from "@/frontend/components/activity-dock";
import { useSpaces } from "@/frontend/components/space-context";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { useSettingsSaved } from "@/frontend/components/settings-signal";
import { noAgentHere, useTerminals } from "@/frontend/components/terminal/use-terminals";
import { TeacherPanel, panelFillsWindow } from "./teacher-panel";
import { TeacherContext, useTeacher, type TeacherApi, type LessonPresence } from "./teacher-context";
import { useTeacherPanel } from "./use-teacher-panel";
import { panelBody, panelStarts, shownScreen } from "./dock-model";
import { STEP_MS, nextStep } from "./tour";
import { FOLLOW_DEFAULT, FOLLOW_KEY, GO_OFFER_MS, followMoves, followReady, followReducer, goOffer, heldStill, OPEN_SHEET_EVENT, openWaits, parseFollow, safePage, sheetDeadline, type FollowEvent, type FollowState } from "./follow";
import { agentDoing, freshAction } from "./follow-status";
import { dialogOpen, highlight, isInView, learnerDialogOpen, pickTarget, sleep, targetElements, waitForTarget } from "./dom";
import { useWindowPage } from "./use-window-page";

/** A run of visits waits this long first, so changes made together are
 *  seen together. */
const GATHER_MS = 250;
const RECENT_LIMIT = 20;

// Most of the app reads the teacher from here.
export { useTeacher };

/** A lesson screen reports whether the teacher is writing or working, and
 *  whether the learner has unsent text (Follow then stays on the lesson). */
export function useTeacherLesson(streaming: boolean, working: boolean, draft: boolean): void {
	const api = useTeacher();
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

export function TeacherProvider({ initialName, children }: { initialName?: string; children: ReactNode }) {
	const [name, setName] = useState(initialName?.trim() || DEFAULT_TEACHER_NAME);
	const agent = useAgentStatus();
	const { feed } = useActivity();
	const spaces = useSpaces();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	useWindowPage(pathname, spaces.active);

	// ── refs the async tour reads (always the latest render's values) ──
	const live = useRef({ name, pathname, spaces, navigate });
	live.current = { name, pathname, spaces, navigate };
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
		const next = goOffer(recent, { follow: followOn, path: pathname, now: Date.now() });
		setOffer(next);
		if (!next) return;
		const t = setTimeout(() => setOffer(null), GO_OFFER_MS - (Date.now() - Date.parse(next.at)));
		return () => clearTimeout(t);
	}, [recent, followOn, pathname]);

	// A held open: what the agent opened while the window held, until it is
	// reached, replaced or stale.
	const [held, setHeld] = useState<AgentAction | null>(null);
	useEffect(() => {
		if (!held) return;
		if (!heldStill(held, { path: pathname, now: Date.now() })) return setHeld(null);
		const t = setTimeout(() => setHeld(null), GO_OFFER_MS - (Date.now() - Date.parse(held.at)));
		return () => clearTimeout(t);
	}, [held, pathname]);

	// ── what it's doing ──
	const doing = useMemo(
		() => agentDoing({ agent, fresh, lesson, extractions: feed.extractions, jobs: feed.jobs }),
		[agent, fresh, lesson, feed.extractions, feed.jobs],
	);

	// ── the panel ──
	const panel = useTeacherPanel();
	const { open: panelOpen, setOpen: setPanelOpen, showTerminal, setList } = panel;
	useDoneSound(panelOpen);

	// ── the tour ──
	const queue = useRef<AgentAction[]>([]);
	// Changes that go to their page whatever Follow says, each with whether
	// the learner clicked for it (an agent's open never jumps a hold).
	const forced = useRef(new Map<string, boolean>());
	const running = useRef(false);
	const holds = useCallback(() => openWaits({ path: live.current.pathname, lessonDraft: !!lessonRef.current?.draft, dialog: learnerDialogOpen() }), []);

	// asked: the learner clicked to go there, so unsent text doesn't hold it.
	const showPage = useCallback(async (action: AgentAction, asked: boolean) => {
		const page = safePage(action.page);
		if (!page) return;
		const { pathname: path, spaces: space, navigate: nav } = live.current;
		const moves = followMoves({ page, spaceId: action.spaceId }, { path, activeSpace: space.active, lessonDraft: !!lessonRef.current?.draft, asked });
		if (moves.switchSpace) space.setActive(moves.switchSpace.to);
		if (moves.go) {
			nav(moves.go);
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

	// One change: its page (when following or `go`), then its item lit up.
	const visit = useCallback(
		async (action: AgentAction, go: boolean, asked: boolean) => {
			const following = go || followRef.current.on;
			// The lesson you are reading: the reply is right here.
			if (!go && action.page.startsWith("/chat/") && action.page === live.current.pathname) return;
			if (following) await showPage(action, asked);
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
	}, [burst, visit, waitUntilFollowReady, holds]);

	// The panel stays while the page shows; across the whole window it gets out of the way.
	const stepAside = useCallback(() => {
		if (panelFillsWindow()) setPanelOpen(false);
		else setList(false);
	}, [setPanelOpen, setList]);

	useServerEvent("agent-action", (action) => {
		if (!action || typeof action.id !== "string") return;
		setRecent((list) => [action, ...list.filter((a) => a.id !== action.id)].slice(0, RECENT_LIMIT));
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
	});

	const go = useCallback(
		(action: AgentAction) => {
			stepAside();
			setHeld((h) => (h?.id === action.id ? null : h));
			// Not queued twice if it is still waiting.
			queue.current = [...queue.current.filter((a) => a.id !== action.id), action];
			forced.current.set(action.id, true);
			void run();
		},
		[run, stepAside],
	);

	const terminals = useTerminals();
	const view = panelBody(!!terminals?.available);
	const shown = usePresence(panelOpen);
	const starts =
		panelOpen &&
		panelStarts({
			view,
			screen: shownScreen(panel.role, !!terminals?.helper),
			terminals: !!terminals?.available,
			noAgent: noAgentHere(agent, terminals),
			teacher: terminals?.teacher ?? null,
			outside: !!terminals?.outsideHere,
		});

	const spaceList = spaces.spaces;
	const spaceNameOf = useCallback((id: string | null) => (id ? (spaceList.find((c) => c.id === id)?.name ?? null) : null), [spaceList]);

	const api = useMemo<TeacherApi>(
		() => ({ name, follow: followOn, setFollow, panelOpen, panelStarts: starts, setPanelOpen, showTerminal, recent, doing, setLesson, go, offer: held ?? offer, held: !!held, spaceNameOf }),
		[name, followOn, setFollow, panelOpen, starts, setPanelOpen, showTerminal, recent, doing, setLesson, go, held, offer, spaceNameOf],
	);

	return (
		<TeacherContext.Provider value={api}>
			{children}
			{/* On the page's top layer. Only the pill closes it. */}
			{shown.mounted &&
				createPortal(
					<TeacherPanel
						name={name}
						agent={agent}
						view={view}
						list={panel.list}
						onList={panel.setList}
						screen={panel.role}
						onScreen={showTerminal}
						focus={panel.focus}
						state={shown.state}
					/>,
					document.body,
				)}
		</TeacherContext.Provider>
	);
}
