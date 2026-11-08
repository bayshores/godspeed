"use client";

/**
 * THE CLASS TREE, the sidebar's first pane: Home, then the classes. The
 * active class is open and lists its pages (overview, graph, files, cheat
 * sheets); clicking another class switches the window to it and opens
 * its overview. Then "no class" (lessons outside a class), the archived
 * classes folded, "add class", and settings.
 */

import { memo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassSummary } from "@/shared/core";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { useClasses } from "@/frontend/components/class-context";
import { useSettingsDialog } from "@/frontend/components/settings/settings-dialog-provider.tsx";
import { useHoverBar } from "@/frontend/components/ui/hover-bar";
import { cn } from "@/frontend/lib/utils";

interface Page {
	href: string;
	label: string;
	testid: string;
	/** Needs a class: hidden under "no class". */
	classOnly?: boolean;
}

const PAGES: readonly Page[] = [
	{ href: "/class", label: "overview", testid: "nav-overview" },
	{ href: "/graph", label: "graph", testid: "nav-graph" },
	{ href: "/class/files", label: "files", testid: "nav-files", classOnly: true },
	{ href: "/class/cheat-sheets", label: "cheat sheets", testid: "nav-cheat-sheets", classOnly: true },
];

/** The class page a path belongs to (exact match; lessons and home match none). */
export function activePageHref(pathname: string): string | null {
	return PAGES.find((p) => p.href === pathname)?.href ?? null;
}

const ROW = "lh-press relative flex w-full items-center gap-[1ch] px-2 py-[5px] text-left text-base";
const rowState = (selected: boolean) => (selected ? "bg-tone font-bold text-ink" : "text-ink-2 hover:text-ink");

/** The fixed-width mark before a row's name. */
function Mark({ children }: { children: string }) {
	return (
		<span aria-hidden className="w-[1ch] shrink-0 text-center text-ink-3">
			{children}
		</span>
	);
}

export const ClassTree = memo(function ClassTree({
	pathname,
	fileCount,
	unseenFiles,
}: {
	pathname: string;
	fileCount: number;
	unseenFiles: boolean;
}) {
	const { classes, active, setActive } = useClasses();
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	const [showArchived, setShowArchived] = useState(false);
	const [creating, setCreating] = useState(false);
	const hover = useHoverBar<HTMLUListElement>();
	const current = classes.filter((c) => !c.archived);
	const archived = classes.filter((c) => c.archived);
	const page = activePageHref(pathname);

	const pick = (id: string | null) => {
		if (id !== active) setActive(id);
		router.push("/class");
	};
	const classRow = (c: ClassSummary, inFold = false) => {
		const open = c.id === active;
		return (
			<li key={c.id}>
				<button
					type="button"
					data-testid={`class-option-${c.id}`}
					data-halley-target={`class:${c.id}`}
					aria-expanded={open}
					onClick={() => pick(c.id)}
					data-row="" className={cn(ROW, inFold && "pl-5", rowState(open && page === "/class"))}
				>
					<Mark>{open ? "▾" : "▸"}</Mark>
					<span title={c.name} className="min-w-0 flex-1 truncate">
						{c.name.toLowerCase()}
					</span>
				</button>
				{open && <ClassPages page={page} hasClass fileCount={fileCount} unseenFiles={unseenFiles} />}
			</li>
		);
	};

	return (
		<nav aria-label="Classes" data-testid="class-tree">
			<ul ref={hover.ref} onPointerOver={hover.onPointerOver} onPointerLeave={hover.onPointerLeave} className="relative flex flex-col">
				{hover.bar}
				<li>
					<Link href="/" data-testid="nav-home" aria-current={pathname === "/" ? "page" : undefined} data-row="" className={cn(ROW, rowState(pathname === "/"))}>
						<Mark>~</Mark>
						<span className="min-w-0 flex-1 truncate">home</span>
					</Link>
				</li>
				{current.map((c) => classRow(c))}
				<li>
					<button type="button" data-testid="class-option-none" aria-expanded={active === null} onClick={() => pick(null)} data-row="" className={cn(ROW, rowState(active === null && page === "/class"))}>
						<Mark>{active === null ? "▾" : "▸"}</Mark>
						<span className="min-w-0 flex-1 truncate">no class</span>
					</button>
					{active === null && <ClassPages page={page} hasClass={false} fileCount={0} unseenFiles={false} />}
				</li>
				{archived.length > 0 && (
					<li>
						<button type="button" data-testid="class-show-archived" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)} data-row="" className={cn(ROW, "text-ink-3 hover:text-ink")}>
							<Mark>{showArchived ? "▾" : "▸"}</Mark>
							<span className="min-w-0 flex-1 truncate">archived ({archived.length})</span>
						</button>
						{/* Always mounted, inert while folded so Tab skips it. */}
						<div className="lh-collapse" data-state={showArchived ? "open" : "closed"} data-testid="class-archived-fold">
							<ul className="flex flex-col" inert={!showArchived}>
								{archived.map((c) => classRow(c, true))}
							</ul>
						</div>
					</li>
				)}
				<li>
					<button type="button" data-testid="class-new" onClick={() => setCreating(true)} data-row="" className={cn(ROW, "text-ink-2 hover:text-ink")}>
						<Mark>+</Mark>
						<span className="min-w-0 flex-1 truncate">add class</span>
					</button>
				</li>
				<li>
					<button type="button" data-testid="settings-entry" onClick={() => openSettings()} data-row="" className={cn(ROW, "text-ink-2 hover:text-ink")}>
						<Mark>*</Mark>
						<span className="min-w-0 flex-1 truncate">settings</span>
					</button>
				</li>
			</ul>
			<ClassDialog mode={creating ? { kind: "create" } : null} onClose={() => setCreating(false)} />
		</nav>
	);
});

/** The open class's pages, indented under it. */
function ClassPages({ page, hasClass, fileCount, unseenFiles }: { page: string | null; hasClass: boolean; fileCount: number; unseenFiles: boolean }) {
	return (
		<ul aria-label="Class pages" className="flex flex-col">
			{PAGES.filter((p) => hasClass || !p.classOnly).map((p) => {
				const selected = p.href === page;
				return (
					<li key={p.href}>
						<Link href={p.href} data-testid={p.testid} aria-current={selected ? "page" : undefined} data-row="" className={cn(ROW, "pl-[calc(3ch+8px)]", rowState(selected))}>
							<span className="min-w-0 flex-1 truncate">{p.label}</span>
							{p.href === "/class/files" && unseenFiles && (
								<span data-testid="nav-files-new" className="shrink-0 text-xs text-tint">
									new
								</span>
							)}
							{p.href === "/class/files" && (
								<span data-testid="nav-files-count" className="shrink-0 font-mono text-xs text-ink-3 tabular-nums">
									{fileCount}
								</span>
							)}
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
