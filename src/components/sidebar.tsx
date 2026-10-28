"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DumbbellIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon } from "lucide-react";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { SettingsDialogProvider } from "@/components/settings/settings-dialog-provider.tsx";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { kbdEventForAction } from "@/core";
import { ClassSwitcher } from "@/components/class-switcher";
import { useClasses } from "@/components/class-context";
import { replayRise } from "@/components/sidebar/motion";
import { ClassNav, HomeRow } from "@/components/sidebar/class-nav";
import { DueSoon } from "@/components/sidebar/due-soon";
import { useOpenDeadlines } from "@/components/use-open-deadlines";
import { LessonsSection } from "@/components/sidebar/lessons-section";
import { SidebarFooter } from "@/components/sidebar/sidebar-footer";
import { HalleyProvider } from "@/components/halley/halley-provider";

export { useRiseOnChange } from "@/components/sidebar/motion";
export { timeAgo, SessionRow, RenameRow } from "@/components/sidebar/session-row";

/**
 * Toggleable sidebar — NOT a modal drawer: no backdrop, no focus theft. It
 * sits inline next to the content and can stay open while working in a
 * session. Open state persists across pages (provider lives in the root
 * layout) and across reloads (localStorage).
 */

const STORAGE_KEY = "lh:sidebar-open";

/*
 * Narrow-window behavior (owner, 2026-09-17): below SIDEBAR_AUTOCLOSE the
 * sidebar would squeeze the page below the 640px window floor (the two
 * numbers compose: 640 + 288 sidebar = 928), so it auto-closes — and
 * auto-RESTORES when the window widens again (owner choice: the sidebar
 * pops back, not a manual re-open). The whole behavior is one expression:
 * rendered = pref && !narrow, where pref is the persisted user choice.
 * Manual closes persist and stay closed; auto-close does not touch the
 * preference. Opening the sidebar while narrow asks the Electron shell to
 * widen the window to the threshold (window.lh.expandWindow, IPC in
 * electron/main.cjs) — the resize listener flips `narrow` and the sidebar
 * appears. In the plain browser there is no window to widen and no
 * suppression — a narrow tab opens the sidebar if the user says so.
 *
 * Mirrors SIDEBAR_AUTOCLOSE in electron/main.cjs — keep in sync.
 */
import type { UpdateState } from "@/components/settings/update-settings.tsx";
const SIDEBAR_AUTOCLOSE = 928;

// Module scope, guarded for SSR (the server has no navigator).
const IS_ELECTRON = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

declare global {
	interface Window {
		/** Preload bridge (electron/preload.cjs) — Electron only, absent in the browser. */
		lh?: {
			/** Read-only host OS; determines the native-control gutter. */
			platform?: string;
			/** Native folder picker (classes wave): absolute path or null. */
			pickFolder?: () => Promise<string | null>;
			/** A dropped file's or folder's absolute path (onboarding drop zone). */
			pathForFile?: (file: File) => string;
			expandWindow: () => void;
			/** The zoom truth (owner round 7): subscribes to "lh:zoom" pushes; returns unsubscribe. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Observational update events and a snapshot for late subscribers. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** Explicit manual check also downloads and stages available updates. */
			checkForUpdates?: () => Promise<void>;
			installUpdate?: () => void;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
		};
	}
}

const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
	open: false,
	toggle: () => {},
});

function useSidebar() {
	return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
	// Start closed so server and client first-render agree (no hydration
	// mismatch); the stored value is applied after mount.
	const [open, setOpen] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		// Electron shell detection (merged chrome, 2026-09-17): keys the
		// .lh-electron CSS (src/app/globals.css) that turns the header bands
		// into the window's drag surface. Post-mount only — server HTML
		// and first client render must agree (no hydration mismatch),
		// and in the plain browser the class never appears.
		if (IS_ELECTRON) {
			document.documentElement.classList.add("lh-electron");
			document.documentElement.dataset.lhPlatform = window.lh?.platform ?? "";
		}

		// THE ZOOM TRUTH (owner round 7, 2026-10-05): ⌘±/⌘0 zoom the UI
		// (Electron zoomFactor) while the native traffic lights stay
		// physical-fixed — the CSS gutter lengths divide by this factor so
		// their RENDERED size never moves. getZoom covers the first-paint
		// race; every later change arrives as an lh:zoom push.
		const setZoomVar = (factor: number) =>
			document.documentElement.style.setProperty("--lh-zoom", String(factor));
		const off = window.lh?.onZoom?.(setZoomVar);
		void window.lh?.getZoom?.().then(setZoomVar);

		const stored = localStorage.getItem(STORAGE_KEY);
		// Default: open (first run introduces the sidebar).
		setOpen(stored === null ? true : stored === "1");
		setMounted(true);
		return () => off?.();
	}, []);

	// Narrow-window auto-close/auto-restore (see SIDEBAR_AUTOCLOSE note):
	// fires only on actual resizes — a boolean compare, no layout work.
	// Both this and the mount effect land before the first paint, so a
	// narrow window never flashes the open sidebar on load.
	useEffect(() => {
		if (!IS_ELECTRON) return; // plain-browser tabs open freely
		const onResize = () => setNarrow(window.innerWidth < SIDEBAR_AUTOCLOSE);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const toggle = useCallback(() => {
		// Opening while narrow (auto-closed, or the user's own closed-at-
		// narrow): ask the shell to widen to the threshold — the resize
		// listener flips `narrow` and the sidebar appears. The preference
		// persists like any other open, so a restart at a narrow width
		// still auto-restores when widened.
		if (narrow && !open) {
			localStorage.setItem(STORAGE_KEY, "0");
			setOpen(true);
			window.lh?.expandWindow();
			return;
		}
		setOpen((v) => {
			localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
			return !v;
		});
	}, [narrow, open]);

	// ⌘B: the global shortcut dispatches kbdEventForAction("toggle-sidebar")
	// and the context answers on exactly that name — the shared spelling
	// is the fix for the interlude bug (the listener sat on the pre-
	// convention name "lh:toggle-sidebar" while the dispatcher sent
	// "lh:kbd-toggle-sidebar", so ⌘B silently did nothing; owner
	// 2026-09-25).
	useEffect(() => {
		const event = kbdEventForAction("toggle-sidebar");
		const onToggle = () => toggle();
		window.addEventListener(event, onToggle);
		return () => window.removeEventListener(event, onToggle);
	}, [toggle]);

	return (
		<SidebarContext.Provider value={{ open: open && !narrow, toggle }}>
			{/* transitions gated on mount: no slide-in flash on page load;
			    motion-safe: reduced motion opens/closes at once (motion wave,
			    owner 2026-10-26) */}
			<div className={cn("flex h-dvh", mounted && "motion-safe:[&_.sidebar-motion]:transition-[width,margin,opacity]")}>{children}</div>
		</SidebarContext.Provider>
	);
}

/** The sidebar slide's timing — the motion tokens (motion wave, owner
 *  2026-10-26; was duration-200 + the default ease). Shared by the
 *  sidebar and its header toggle so the two stay in lockstep. */
const SIDEBAR_MOTION = "duration-[var(--lh-dur-slow)] ease-[var(--lh-ease-out)]";

/** Hamburger for page headers — only visible when the sidebar is closed.
 *
 *  Owner, round 6c: the toggle is ALWAYS MOUNTED, owning a slot whose
 *  width+margin animate in LOCKSTEP with the sidebar's own width
 *  transition (same duration-200, same easing, both gated on mount) —
 *  before, it mounted/unmounted in one frame, so its 48px footprint
 *  (button + gap) popped and dragged the title and chips sideways while
 *  the sidebar was still mid-slide. When open the slot is exactly zero
 *  (w-0 -mr-3: width 0, the negative margin cancels the header's gap-3),
 *  so resting layouts are pixel-identical to the old conditional render.
 *  The icon fades with the slot and is clipped by it as it collapses —
 *  no popping in either direction. */
export function SidebarToggle() {
	const { open, toggle } = useSidebar();
	return (
		<span
			className={cn(
				"sidebar-motion lh-no-drag relative flex h-9 shrink-0 overflow-hidden", SIDEBAR_MOTION,
				open ? "w-0 -mr-3" : "w-9 mr-0 lh-closed-toggle",
			)}
		>
			<Hint label="Open sidebar" action="toggle-sidebar">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Open sidebar"
				aria-hidden={open}
				tabIndex={open ? -1 : 0}
				onClick={toggle}
				className={cn("sidebar-motion", SIDEBAR_MOTION, open ? "pointer-events-none opacity-0" : "opacity-100")}
			>
				{/* Owner, round 6: size-4, SAME as the close glyph — the toggle
				    must not grow when the sidebar is closed (it did: size-5 here).
				    The small look is the standard, both directions. */}
				<PanelLeftOpenIcon className="size-4" />
			</Button>
			</Hint>
		</span>
	);
}

/** The sidebar's two buttons: tone blocks, 13.5px bold. */
const NEW_BUTTON =
	"lh-press flex flex-1 items-center justify-center gap-[7px] bg-tone py-[9px] text-[13.5px] font-bold text-ink hover:bg-tone-2";

/**
 * THE SIDEBAR (redesign 2026-10-27, the same on every screen): the window
 * row (traffic lights + close), Home, the class switcher, the class nav
 * (Overview / Graph / Files), "New lesson" and "Practice", Due soon
 * (2026-10-28), the lessons, and the footer (outside agent · jobs,
 * settings).
 */
function SessionsSidebar() {
	const { open, toggle } = useSidebar();
	const pathname = usePathname();
	const { active: activeClassId, activeClass } = useClasses();
	const due = useOpenDeadlines();

	return (
		<aside
			className={cn("sidebar-motion shrink-0 overflow-hidden", SIDEBAR_MOTION, open ? "w-64" : "w-0")}
			aria-hidden={!open}
		>
			<div className="flex h-full w-64 flex-col items-start gap-3.5 border-r border-tone-2 bg-background px-2.5 pb-3">
				{/* The window row: in Electron it is the window's drag surface and
				    the native traffic lights sit in its left gutter
				    (.lh-lights-gutter); the close toggle sits at the right edge.
				    44px tall so the lights (centered 22px down) line up with it;
				    -mb-2.5 keeps the design's 48px to the class switcher. */}
				<div className="lh-drag lh-lights-gutter -mb-2.5 flex h-11 w-full shrink-0 items-center justify-end px-1">
					<Hint label="Close sidebar" action="toggle-sidebar">
						<button
							type="button"
							aria-label="Close sidebar"
							onClick={toggle}
							className="lh-press lh-no-drag flex size-7 items-center justify-center text-ink-2 hover:bg-tone hover:text-ink"
						>
							<PanelLeftCloseIcon className="size-4" />
						</button>
					</Hint>
				</div>

				<HomeRow pathname={pathname} />

				<ClassSwitcher />

				<ClassNav pathname={pathname} hasClass={activeClass !== null} fileCount={activeClass?.fileCount ?? 0} />

				{/* New lessons start on the New lesson screen ("/new"), in Teach or Practice mode. */}
				<div className="flex w-full gap-0.5">
					<Link href="/new" data-testid="new-session" className={NEW_BUTTON}>
						<PlusIcon className="size-3.5" aria-hidden />
						New lesson
					</Link>
					<Link href="/new?mode=practice" data-testid="new-session-practice" className={NEW_BUTTON}>
						<DumbbellIcon className="size-3.5" aria-hidden />
						Practice
					</Link>
				</div>

				<DueSoon deadlines={due.deadlines} leaving={due.leaving} onDone={due.markDone} />

				<LessonsSection open={open} toggle={toggle} pathname={pathname} activeClassId={activeClassId} />

				<SidebarFooter />
			</div>
		</aside>
	);
}

/** The view swap (motion wave, owner 2026-10-26): switching between
 *  pages (Home, a lesson, Overview…) rises the incoming page in once. */
function ViewSwap({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const ref = useRef<HTMLDivElement>(null);
	const prev = useRef(pathname);
	useLayoutEffect(() => {
		const from = prev.current;
		prev.current = pathname;
		if (from === pathname) return;
		replayRise(ref.current);
	}, [pathname]);
	return (
		<div ref={ref} className="h-full" style={{ animationDuration: "var(--lh-dur-slow)" }}>
			{children}
		</div>
	);
}

/** The app frame: sidebar inline + content, and Halley over both.
 *  Rendered once in the root layout. */
export function AppShell({ children, teacherName }: { children: React.ReactNode; teacherName?: string }) {
	return (
		<SettingsDialogProvider>
			<HalleyProvider initialName={teacherName}>
			<SessionsSidebar />
			<main className="min-w-0 flex-1">
				<ViewSwap>{children}</ViewSwap>
			</main>
			</HalleyProvider>
			{/* The single document-level keydown listener (keyboard wave A) —
			    after the content in the tree, but it's window-level so order only
			    matters for the events it dispatches, never for DOM priority. */}
			<KeyboardShortcuts />
		</SettingsDialogProvider>
	);
}
