"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { currentVersion } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { DOCK_DEFAULT_W, dockStateKey, dockWidth, makeTarget, parseDockState, pickSheet, sheetChoices, type DockState } from "./dock-model";
import { SheetCanvas } from "./sheet-canvas";
import { versionLabel } from "./studio-states";
import { sheetPdfPath, studioPath, useCheatSheet, useClassSheets } from "./use-cheat-sheet";

const WIDTH_KEY = "lh:sheet-dock-width";

function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		/* no storage or full: it lasts for this visit */
	}
}

/** Whether a session's sheet is open and which one, kept per session in
 *  this browser; read after mount (the page is server-rendered). */
export function useSheetDock(chatId: string) {
	const [state, setState] = useState<DockState>({ open: false });
	const key = dockStateKey(chatId);
	useEffect(() => setState(parseDockState(readStorage(key))), [key]);
	const update = useCallback(
		(patch: Partial<DockState>) =>
			setState((s) => {
				const next = { ...s, ...patch };
				writeStorage(key, JSON.stringify(next));
				return next;
			}),
		[key],
	);
	return { state, update };
}

/**
 * THE CHEAT SHEET BESIDE A LESSON: a column between the reading sheet and
 * the teacher, as wide as the learner drags it. It shows the lesson's
 * deadline's sheet, else the class's next one that has a sheet (a picker
 * when there are several), on the same canvas as the studio (pages one
 * under another, fit to width). It has no chat: asking about the sheet,
 * pointing at a part of it and making one all happen in the studio.
 */
export function SheetDock({
	classId,
	sessionDeadlineId,
	picked,
	onPick,
	onClose,
}: {
	classId: string;
	sessionDeadlineId: string | undefined;
	/** The deadline picked before in this session. */
	picked: string | undefined;
	onPick: (deadlineId: string) => void;
	onClose: () => void;
}) {
	const [width, setWidth] = useState(DOCK_DEFAULT_W);
	useEffect(() => {
		const saved = Number(readStorage(WIDTH_KEY));
		setWidth(dockWidth(saved > 0 ? saved : DOCK_DEFAULT_W, window.innerWidth));
	}, []);
	const drag = useRef<{ x: number; w: number } | null>(null);

	const { view: cards, failed, reload } = useClassSheets(classId);
	const choices = cards ? sheetChoices(cards.cards) : [];
	const shown = cards ? pickSheet(cards.cards, sessionDeadlineId, picked) : null;
	const target = cards ? makeTarget(cards.cards, sessionDeadlineId) : null;
	const shownName = cards?.cards.find((c) => c.deadlineId === shown)?.name;

	return (
		<Pane data-testid="sheet-dock" aria-label="Cheat sheet" style={{ "--lh-dock-w": `${width}px` } as React.CSSProperties} className="lh-sheet-dock flex h-full min-h-0 shrink-0 flex-col">
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Drag to resize the cheat sheet"
				data-testid="sheet-dock-resize"
				className="lh-dock-resize absolute top-0 bottom-0 -left-3 z-10 w-3 cursor-col-resize hover:bg-tone-2"
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					drag.current = { x: e.clientX, w: width };
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (d) setWidth(dockWidth(d.w + d.x - e.clientX, window.innerWidth));
				}}
				onPointerUp={() => {
					drag.current = null;
					writeStorage(WIDTH_KEY, String(width));
				}}
			/>
			<header className="flex shrink-0 items-center gap-2 border-b border-border py-2.5 pr-2 pl-3">
				{choices.length > 1 && shown ? (
					<div className="relative min-w-0 flex-1">
						<select
							data-testid="sheet-dock-pick"
							aria-label="Which cheat sheet"
							value={shown}
							onChange={(e) => onPick(e.target.value)}
							className="h-9 w-full appearance-none truncate rounded border-[1.5px] border-ink bg-panel pr-9 pl-3 text-[15px] font-medium text-ink"
						>
							{choices.map((c) => (
								<option key={c.deadlineId} value={c.deadlineId}>
									Cheat sheet for {c.name}
								</option>
							))}
						</select>
						<PixelIcon name="chevron" className="pointer-events-none absolute top-1/2 right-3 h-[10px] -translate-y-1/2 rotate-90 text-ink" />
					</div>
				) : (
					<span className="min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-ink">{shownName ? `Cheat sheet for ${shownName}` : "Cheat sheet"}</span>
				)}
				<button type="button" data-testid="sheet-dock-close" onClick={onClose} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
					<PixelIcon name="close" />
					Close
				</button>
			</header>
			{failed ? (
				<LoadFailed message="Couldn't load your cheat sheets." onRetry={() => void reload()} className="px-5 py-4" />
			) : !cards ? null : shown ? (
				<DockedSheet key={shown} classId={classId} deadlineId={shown} />
			) : (
				<div data-testid="sheet-dock-none" className="flex min-h-0 flex-1 flex-col items-start gap-3 bg-background px-4 py-5 text-[15px] text-ink-2">
					<p>No cheat sheet yet.</p>
					{target ? (
						<Link href={studioPath(target)} data-testid="sheet-dock-make" className="lh-btn lh-btn-main text-[15px]">
							Make one
						</Link>
					) : (
						<p>Add a deadline to this class to make one.</p>
					)}
				</div>
			)}
		</Pane>
	);
}

function DockedSheet({ classId, deadlineId }: { classId: string; deadlineId: string }) {
	const { view, loadError, reload } = useCheatSheet(classId, deadlineId);
	const pdfUrl = useCallback((n: number) => sheetPdfPath(classId, deadlineId, n), [classId, deadlineId]);
	if (loadError) return <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-5 py-4" />;
	if (!view) return null;
	const current = currentVersion(view.sheet);
	if (!current) return null;
	return (
		<SheetCanvas
			versions={[current]}
			pdfUrl={pdfUrl}
			labelFor={versionLabel}
			narrow
			foot={
				<div className="flex w-full items-center gap-2">
					{/* Pointing sends a picture with a message, so it happens where the chat is. */}
					<Link href={studioPath(deadlineId)} data-testid="sheet-dock-point" className="lh-btn text-[15px]">
						Point at the sheet
					</Link>
					<span className="flex-1" />
					<Link href={studioPath(deadlineId)} data-testid="sheet-dock-studio" className="lh-btn lh-btn-quiet text-[15px]">
						Open full size
					</Link>
				</div>
			}
		/>
	);
}
