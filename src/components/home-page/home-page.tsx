"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import type { ClassSummary, DeadlineProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { ClassDialog, type ClassDialogMode } from "@/components/class-dialog";
import { useMinute } from "@/components/countdown";
import { byDue, longDateLine } from "@/components/deadlines-model";
import { MenuShell } from "@/components/menu-shell";
import { lessonHref } from "@/components/overview/overview-model";
import { TopBar } from "@/components/top-bar";
import { useOpenDeadlines } from "@/components/use-open-deadlines";
import { ClassBlock } from "./class-block";
import { ComingUp } from "./coming-up";
import { classesSettled, classSlot } from "./home-page-model";
import { useClassesProgress } from "./use-classes-progress";

/**
 * HOME ("/"): the title and today's
 * date, "Coming up" (every open deadline from every class) and one block
 * per class. The top bar's "Add deadline" opens a class's Edit class with
 * a new deadline row (a menu picks the class when there are several).
 */
export function HomePage() {
	const router = useRouter();
	const { classes, loaded, setActive } = useClasses();
	const shown = useMemo(() => classes.filter((c) => !c.archived), [classes]);
	const { deadlines, error: deadlinesError, leaving, markDone } = useOpenDeadlines();
	const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
	const classesProgress = useClassesProgress(shownIds);
	// The blocks fill in together the first time; a class added later
	// shows its own box until its progress arrives.
	const [blocksReady, setBlocksReady] = useState(false);
	if (!blocksReady && shown.length > 0 && classesSettled(shownIds, classesProgress)) setBlocksReady(true);
	const nowMs = useMinute();
	const [dialog, setDialog] = useState<ClassDialogMode | null>(null);

	// Each deadline's covers and ready %, from its class's progress.
	const deadlineProgress = useMemo(() => {
		const map = new Map<string, DeadlineProgress>();
		for (const p of classesProgress.progress.values()) for (const d of p.deadlines) map.set(d.id, d);
		return map;
	}, [classesProgress]);
	const nextDue = useMemo(() => {
		const map = new Map<string, NonNullable<typeof deadlines>[number]>();
		for (const d of byDue(deadlines ?? [])) if (!map.has(d.classId) && !leaving.has(d.id)) map.set(d.classId, d);
		return map;
	}, [deadlines, leaving]);

	const go = useCallback(
		(classId: string, href: string) => {
			setActive(classId);
			router.push(href);
		},
		[router, setActive],
	);
	const onContinue = useCallback((classId: string, chatId: string) => go(classId, lessonHref(chatId)), [go]);
	const onNewLesson = useCallback((classId: string) => go(classId, "/new"), [go]);
	const onOpenClass = useCallback((classId: string) => go(classId, "/class"), [go]);

	return (
		<div data-testid="home-page" className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex-1" />
				{shown.length > 0 && <AddDeadline classes={shown} onPick={(classId) => setDialog({ kind: "edit", classId, newDeadline: true })} />}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="@container flex w-full flex-col pb-8">
					<header className="flex flex-col gap-2 px-[52px] py-6">
						<h1 className="font-title text-[40px] leading-[48px] tracking-tight text-ink">Home</h1>
						<p data-testid="home-date" className="min-h-6 text-base leading-6 text-ink-2">
							{nowMs !== null ? longDateLine(nowMs) : ""}
						</p>
					</header>
					{nowMs === null || !loaded || (deadlines === null && deadlinesError === null) ? (
						<div className="px-[52px]">
							<LoadingBox height="h-[320px]" />
						</div>
					) : (
						<div className="flex flex-col items-start gap-4 px-[52px] @4xl:flex-row">
							<div className="w-full min-w-0 flex-1">
								{deadlines ? (
									<ComingUp
										deadlines={deadlines}
										progress={deadlineProgress}
										leaving={leaving}
										nowMs={nowMs}
										hasClasses={shown.length > 0}
										onDone={markDone}
									/>
								) : (
									<LoadFailed />
								)}
							</div>
							{shown.length > 0 && (
								<div className="flex w-full flex-col gap-4 @4xl:w-[400px] @4xl:shrink-0">
									{shown.map((c) => {
										const slot = classSlot(c.id, classesProgress, blocksReady);
										const p = classesProgress.progress.get(c.id);
										if (slot === "block" && p) {
											return (
												<ClassBlock
													key={c.id}
													cls={c}
													progress={p}
													nextDue={nextDue.get(c.id) ?? null}
													nowMs={nowMs}
													onContinue={onContinue}
													onNewLesson={onNewLesson}
													onOpenClass={onOpenClass}
												/>
											);
										}
										return slot === "failed" ? <LoadFailed key={c.id} /> : <LoadingBox key={c.id} height="h-[222px]" />;
									})}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
			<ClassDialog mode={dialog} onClose={() => setDialog(null)} />
		</div>
	);
}

/** A plain card-coloured box shown until Home's data arrives, so nothing
 *  appears in a half-loaded state and then jumps. */
function LoadingBox({ height }: { height: string }) {
	return <div data-testid="home-loading" aria-hidden className={`w-full bg-panel ${height}`} />;
}

/** Shown in place of a loading box when its read failed; the hooks re-read
 *  on the next change. */
function LoadFailed() {
	return <p data-testid="home-load-failed" className="text-sm text-ink-3">{"Couldn't load this. It will try again when something changes."}</p>;
}

/** "Add deadline": one class opens its Edit class at once; several open a
 *  menu of classes first. */
function AddDeadline({ classes, onPick }: { classes: readonly ClassSummary[]; onPick: (classId: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);

	// The menu contract: a pointerdown outside closes it; Esc is claimed.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const single = classes.length === 1 ? classes[0]! : null;
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="home-add-deadline"
				aria-haspopup={single ? undefined : "menu"}
				aria-expanded={single ? undefined : open}
				onClick={() => (single ? onPick(single.id) : setOpen((v) => !v))}
				className="lh-press flex items-center gap-[7px] bg-panel px-2.5 py-[7px] text-sm text-ink hover:bg-tone"
			>
				<PlusIcon className="size-3.5" aria-hidden />
				Add deadline
			</button>
			{!single && (
				<MenuShell
					open={open}
					anchorRef={anchorRef}
					testid="home-add-deadline-menu"
					preferredSide="down"
					align="right"
					menuClass="lh-glass flex w-[236px] flex-col gap-0.5 p-1.5"
				>
					{classes.map((c) => (
						<button
							key={c.id}
							type="button"
							data-testid={`home-add-deadline-${c.id}`}
							onClick={() => {
								setOpen(false);
								onPick(c.id);
							}}
							className="lh-press flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-tone"
						>
							<span className="min-w-0 flex-1 truncate">{c.name}</span>
						</button>
					))}
				</MenuShell>
			)}
		</>
	);
}
