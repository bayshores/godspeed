import { useCallback, useEffect, useState } from "react";
import { SidebarContext, useSidebar } from "@/frontend/components/sidebar/sidebar-context";
import { useLocation } from "react-router";
import { useUnseenFiles } from "@/frontend/components/sidebar/files-seen";
import { cn } from "@/frontend/lib/utils";
import { kbdEventForAction } from "@/shared/core";
import { useClasses } from "@/frontend/components/class-context";
import { ClassTree } from "@/frontend/components/sidebar/class-tree";
import { LessonsSection } from "@/frontend/components/sidebar/lessons-section";
import { TeacherPane } from "@/frontend/components/halley/teacher-pane";
import { toggledSidebar } from "@/frontend/components/sidebar-model";
import { Pane } from "@/frontend/components/ui/pane";
import { ResizeHandle, usePaneWidth } from "@/frontend/components/ui/resize-handle";

export { useRiseOnChange } from "@/frontend/components/sidebar/motion";
export { SessionRow, RenameRow } from "@/frontend/components/sidebar/session-row";

/**
 * Toggleable sidebar — NOT a modal drawer: no backdrop, no focus theft. It
 * sits inline next to the content and can stay open while working in a
 * session. Open state persists across pages (provider lives in
 * src/frontend/routes/root.tsx) and across reloads (localStorage).
 */

const STORAGE_KEY = "lh:sidebar-open";

/*
 * Narrow-window behavior: below SIDEBAR_AUTOCLOSE the sidebar auto-closes,
 * and auto-RESTORES when the window widens again (no manual re-open). The
 * number is fixed, not derived from the sidebar's width (SIDEBAR_WIDTH:
 * 256px to start, dragged between 200 and 360); at the starting width it
 * leaves the page 744px, above the 640px window floor. The whole behavior
 * is one expression: rendered = pref && !narrow, where pref is the
 * persisted user choice.
 * Manual closes persist and stay closed; auto-close does not touch the
 * preference. Opening the sidebar while narrow asks the desktop shell to
 * widen the window to the threshold (window.lh.expandWindow, handled in
 * crates/shell/src/window.rs) — the resize listener flips `narrow` and the sidebar
 * appears. In the plain browser there is no window to widen and no
 * suppression — a narrow tab opens the sidebar if the user says so.
 *
 * Mirrors SIDEBAR_AUTOCLOSE in crates/shell/src/window.rs — keep in sync.
 */
import type { UpdateState } from "@/frontend/components/settings/update-settings.tsx";
const SIDEBAR_AUTOCLOSE = 1000;

// The shell's shim defines window.lh before the page's scripts run; false in a plain browser.
const IS_DESKTOP = typeof window !== "undefined" && !!window.lh;

declare global {
	interface Window {
		/** The desktop shell's bridge (crates/shell/src/shim.js), absent in a plain browser. */
		lh?: {
			/** Read-only host OS; determines the native-control gutter. */
			platform?: string;
			/** Native folder picker: absolute path or null. */
			pickFolder?: () => Promise<string | null>;
			/** Opens Finder (File Explorer) with this file selected. */
			showInFolder?: (path: string) => Promise<void>;
			/** Opens this folder in Finder (File Explorer), or this PDF in its default app. */
			openPath?: (path: string) => Promise<void>;
			/** Opens a terminal running the godspeed folder's start script: null, or why it couldn't. */
			openAgent?: (folder: string, agent: "claude" | "codex") => Promise<string | null>;
			/** A dropped file's or folder's absolute path, or "" where the OS gives none (onboarding drop zone). */
			pathForFile?: (file: File) => Promise<string>;
			expandWindow: () => void;
			/** The first screen is drawn: show the window (hidden until then). */
			showWindow?: () => void;
			/** The zoom truth: subscribes to "lh:zoom" pushes; returns unsubscribe. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Observational update events and a snapshot for late subscribers. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** Explicit manual check also downloads and stages available updates. */
			checkForUpdates?: () => Promise<void>;
			installUpdate?: () => void;
			/** Opens a new GitHub issue with the app version and OS filled in. */
			reportBug?: () => void;
			/** The installed font families, sorted. */
			listFonts?: () => Promise<string[]>;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
			/** Opens the system print sheet for a PDF in the data folder. Mac only. */
			printPdf?: (path: string) => Promise<void>;
		};
	}
}

/** Folds the sidebar away while the calling page is open (the cheat sheet
 *  studio gives the paper the room). The toggle still opens it. */
export function useFoldSidebar(): void {
	const { fold } = useSidebar();
	useEffect(() => {
		fold(true);
		return () => fold(false);
	}, [fold]);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
	// Starts closed; the stored choice is read after mount (below).
	const [open, setOpen] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [folded, setFolded] = useState(false);

	useEffect(() => {
		// Desktop shell detection: keys the .lh-desktop CSS
		// (src/frontend/globals.css) that makes room for the traffic lights.
		// Set after mount, like the stored state below; in the plain
		// browser the class never appears.
		if (IS_DESKTOP) {
			document.documentElement.classList.add("lh-desktop");
			document.documentElement.dataset.lhPlatform = window.lh?.platform ?? "";
		}

		// THE ZOOM TRUTH: ⌘±/⌘0 zoom the UI (the webview's zoom) while the native traffic lights stay
		// physical-fixed — the CSS gutter lengths divide by this factor so
		// their RENDERED size never moves. getZoom covers the first-paint
		// race; every later change arrives as a zoom push.
		const setZoomVar = (factor: number) =>
			document.documentElement.style.setProperty("--lh-zoom", String(factor));
		const off = window.lh?.onZoom?.(setZoomVar);
		void window.lh?.getZoom?.().then(setZoomVar);

		const stored = localStorage.getItem(STORAGE_KEY);
		// Default: open (first run introduces the sidebar).
		setOpen(stored === null ? true : stored === "1");
		// Transitions turn on only after the stored state has painted; in the
		// same render the width would slide in from 0 on every load.
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setMounted(true));
		});
		return () => {
			cancelAnimationFrame(frame);
			off?.();
		};
	}, []);

	// Narrow-window auto-close/auto-restore (see SIDEBAR_AUTOCLOSE note):
	// fires only on actual resizes — a boolean compare, no layout work.
	// Both this and the mount effect land before the first paint, so a
	// narrow window never flashes the open sidebar on load.
	useEffect(() => {
		if (!IS_DESKTOP) return; // plain-browser tabs open freely
		const onResize = () => setNarrow(window.innerWidth < SIDEBAR_AUTOCLOSE);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const toggle = useCallback(() => {
		if (folded) {
			setFolded(false);
			if (open && !narrow) return;
		}
		const next = toggledSidebar(open, narrow);
		localStorage.setItem(STORAGE_KEY, next.open ? "1" : "0");
		setOpen(next.open);
		// The resize listener then flips `narrow` and the sidebar appears.
		if (next.expand) window.lh?.expandWindow();
	}, [open, narrow, folded]);

	// ⌘B: the global shortcut dispatches kbdEventForAction("toggle-sidebar")
	// and the context answers on exactly that name — one shared spelling,
	// so the listener and the dispatcher can't drift apart.
	useEffect(() => {
		const event = kbdEventForAction("toggle-sidebar");
		const onToggle = () => toggle();
		window.addEventListener(event, onToggle);
		return () => window.removeEventListener(event, onToggle);
	}, [toggle]);

	return (
		<SidebarContext.Provider value={{ open: open && !narrow && !folded, toggle, fold: setFolded }}>
			{/* transitions gated on mount: no slide-in flash on page load;
			    motion-safe: reduced motion opens/closes at once */}
			<div className={cn("flex h-dvh flex-col", mounted ? "motion-safe:[&_.sidebar-motion]:transition-[width,margin,opacity]" : "[&_.sidebar-motion]:transition-none")}>{children}</div>
		</SidebarContext.Provider>
	);
}

/** The sidebar slide's timing: the motion tokens. */
const SIDEBAR_MOTION = "duration-[var(--lh-dur-slow)] ease-[var(--lh-ease-out)]";

/** The sidebar's width (drag its border line to change it). */
const SIDEBAR_WIDTH = { initial: 300, min: 240, max: 400 };

/**
 * THE SIDEBAR (the same on every screen but a lesson's): three panes, the
 * class tree, the lessons and the teacher.
 */
export function SessionsSidebar() {
	const { open, toggle } = useSidebar();
	const { pathname } = useLocation();
	const { active: activeClassId, activeClass } = useClasses();
	const unseenFiles = useUnseenFiles(activeClassId, activeClass?.lastFoundAt, pathname === "/class/files");
	const [width, setWidth] = usePaneWidth("sidebar", SIDEBAR_WIDTH);

	return (
		<aside
			aria-label="Sidebar"
			className={cn("sidebar-motion relative shrink-0 overflow-hidden", SIDEBAR_MOTION)}
			style={{ width: open ? width : 0 }}
			inert={!open}
		>
			<div className="flex h-full flex-col gap-5 overflow-y-auto px-4 pt-6 pb-4" style={{ width }}>
				<Pane className="shrink-0 px-2 py-2.5">
					<ClassTree pathname={pathname} fileCount={activeClass?.fileCount ?? 0} unseenFiles={unseenFiles} />
				</Pane>
				<LessonsSection open={open} toggle={toggle} pathname={pathname} activeClassId={activeClassId} />
				<TeacherPane />
			</div>
			{open && <ResizeHandle paneKey="sidebar" edge="right" width={width} bounds={SIDEBAR_WIDTH} onWidth={setWidth} label="Resize the sidebar" />}
		</aside>
	);
}
