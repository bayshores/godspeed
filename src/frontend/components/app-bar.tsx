"use client";

/**
 * THE TOP BAR, one for the whole window: the sidebar toggle, the page's
 * path ("cse 29 / review for my exam"), the page's own buttons, the
 * teacher's status while the sidebar is closed (its pane shows it
 * otherwise), and the clock.
 *
 * Pages fill it with <TopBar path={…}>buttons</TopBar>, which renders into
 * the bar's slots. The path starts at the active class, or at "~" for
 * pages outside a class (Home). In Electron the bar is the window's drag band, with the
 * traffic lights in its left gutter; clickable elements carve out of the
 * drag region on their own (globals.css).
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PanelLeftIcon } from "lucide-react";
import { useClasses } from "@/frontend/components/class-context";
import { useMinute } from "@/frontend/components/countdown";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { TeacherSprite } from "@/frontend/components/halley/teacher-sprite";
import { useSidebar } from "@/frontend/components/sidebar/sidebar-context";
import { Hint } from "@/frontend/components/ui/hint";
import { cn } from "@/frontend/lib/utils";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { clockText, retypeStep, rootCrumb, type Crumb } from "./app-bar-model";

const PATH_SLOT = "lh-bar-path";
/** The path retypes one letter at a time, this fast. */
const LETTER_MS = 15;
const ACTIONS_SLOT = "lh-bar-actions";

/** True under the app shell, where the top bar is on the page. */
const BarContext = createContext(false);

/** Marks the pages under it as having the top bar (the app shell). */
export function WithAppBar({ children }: { children: ReactNode }) {
	return <BarContext.Provider value>{children}</BarContext.Provider>;
}

export function AppBar() {
	const { open, toggle } = useSidebar();
	return (
		<header data-testid="app-bar" className="lh-drag lh-lights-gutter lh-wco-gutter flex h-11 shrink-0 select-none items-center gap-4 border-b border-tone-2 bg-card pr-4 pl-3">
			<Hint label={open ? "Close sidebar" : "Open sidebar"} side="bottom">
				<button
					type="button"
					aria-label={open ? "Close sidebar" : "Open sidebar"}
					aria-expanded={open}
					data-testid="sidebar-toggle"
					onClick={toggle}
					className="lh-press flex size-7 shrink-0 items-center justify-center text-ink-2 hover:bg-tone hover:text-ink"
				>
					<PanelLeftIcon className="size-4" aria-hidden />
				</button>
			</Hint>
			<nav id={PATH_SLOT} aria-label="Path" className="flex min-w-0 flex-1 items-center text-base" />
			<div id={ACTIONS_SLOT} className="flex shrink-0 items-center gap-3" />
			{!open && <TeacherStatus />}
			<Clock />
		</header>
	);
}

/** The teacher's mascot and what it's doing; a click opens its panel. */
function TeacherStatus() {
	const halley = useHalley();
	if (!halley) return null;
	const doing = halley.doing;
	return (
		<button
			type="button"
			data-testid="bar-teacher"
			data-halley-panel-toggle=""
			aria-expanded={halley.panelOpen}
			onClick={() => halley.setPanelOpen(!halley.panelOpen)}
			className="lh-press flex min-w-0 shrink items-center gap-2 px-1.5 py-1 text-sm text-ink-2 hover:bg-tone hover:text-ink"
		>
			<TeacherSprite mood={halley.mood} className="w-3.5 shrink-0" />
			{doing ? (
				<span className="max-w-[260px] truncate">{doing.text.toLowerCase()}</span>
			) : (
				<span>{halley.name.toLowerCase()}</span>
			)}
			{doing?.working && <BrailleSpinner />}
		</button>
	);
}

function Clock() {
	const minute = useMinute();
	return (
		<span data-testid="bar-clock" className="shrink-0 font-mono text-sm text-ink-2 tabular-nums">
			{minute === null ? "" : clockText(new Date(minute))}
		</span>
	);
}

/** The bar's slot elements, once the bar is on the page. A page rendered
 *  without the bar (a test) shows its part in place instead. */
function useSlots(): { path: HTMLElement | null; actions: HTMLElement | null } {
	const [slots, setSlots] = useState<{ path: HTMLElement | null; actions: HTMLElement | null }>({ path: null, actions: null });
	useEffect(() => {
		setSlots({ path: document.getElementById(PATH_SLOT), actions: document.getElementById(ACTIONS_SLOT) });
	}, []);
	return slots;
}

/**
 * A page's part of the top bar: its path after the class (or "~" when
 * `inClass` is false) and its buttons. `tail` replaces the last segment
 * with something live (the lesson's rename button).
 */
export function TopBar({
	path,
	inClass = true,
	tail,
	children,
}: {
	path: readonly Crumb[];
	inClass?: boolean;
	tail?: ReactNode;
	children?: ReactNode;
}) {
	const slots = useSlots();
	const hasBar = useContext(BarContext);
	const { activeClass } = useClasses();
	const full = [rootCrumb(inClass ? activeClass : null), ...path];
	if (!hasBar) {
		return (
			<header className="flex h-11 items-center gap-3 px-3">
				<Path path={full} tail={tail} retype={false} />
				{children}
			</header>
		);
	}
	return (
		<>
			{slots.path && createPortal(<Path path={full} tail={tail} retype />, slots.path)}
			{slots.actions && children && createPortal(children, slots.actions)}
		</>
	);
}

/** The path as last shown, so the next page's path retypes from it. */
let lastShown: readonly string[] = [];

/** The labels as shown while the path retypes from the last page's path:
 *  old parts erase, new ones type in. Reduce motion, or a path outside the
 *  top bar (`on` false), shows it at once. */
function useRetyped(labels: readonly string[], on: boolean): readonly string[] {
	const key = labels.join("\u0000");
	const [shown, setShown] = useState<readonly string[]>(() => (on && lastShown.length > 0 ? lastShown : labels));
	const target = useRef(labels);
	target.current = labels;
	useEffect(() => {
		if (!on || prefersReducedMotion()) {
			setShown(target.current);
			return;
		}
		const timer = setInterval(() => {
			setShown((s) => {
				const next = retypeStep(s, target.current);
				if (next === s) clearInterval(timer);
				return next;
			});
		}, LETTER_MS);
		return () => clearInterval(timer);
	}, [key, on]);
	useEffect(() => {
		if (on) lastShown = shown;
	}, [shown, on]);
	return shown;
}

function Path({ path, tail, retype }: { path: readonly Crumb[]; tail?: ReactNode; retype: boolean }) {
	const { active, setActive } = useClasses();
	const last = path.length - 1;
	const shown = useRetyped(path.map((c) => c.label), retype);
	const typed = shown.length === path.length && shown[last] === path[last]?.label;
	return (
		<ol data-testid="bar-path" className="flex min-w-0 items-center">
			{path.slice(0, shown.length).map((c, i) => (
				<li key={`${i}-${c.label}`} className={cn("flex items-center", i === last && !tail ? "min-w-0 shrink" : "max-w-[24ch] shrink-0")}>
					{i > 0 && <span aria-hidden className="px-2 text-ink-3">/</span>}
					{c.href && (i < last || tail) ? (
						<Link
							href={c.href}
							prefetch={false}
							onClick={() => {
								if (c.classId && c.classId !== active) setActive(c.classId);
							}}
							aria-label={c.label === "~" ? "Home" : undefined}
							className="-mx-2 -my-1 truncate px-2 py-1 text-ink-2 hover:text-ink"
						>
							{shown[i]}
						</Link>
					) : (
						<span aria-current="page" className="truncate font-bold text-ink">
							{shown[i]}
						</span>
					)}
				</li>
			))}
			{tail && typed && (
				<li className="flex min-w-0 shrink items-center">
					<span aria-hidden className="px-2 text-ink-3">/</span>
					{tail}
				</li>
			)}
		</ol>
	);
}
