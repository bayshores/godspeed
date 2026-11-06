"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { currentVersion, type SheetAbout } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { LoadFailed } from "@/frontend/components/load-failed";
import { DOCK_DEFAULT_W, dockStateKey, dockWidth, makeTarget, parseDockState, pickSheet, sheetChoices, type DockState } from "./dock-model";
import { SheetCanvas } from "./sheet-canvas";
import { SheetChat } from "./sheet-chat";
import { emptyChatLine, versionLabel } from "./studio-states";
import { sheetPdfPath, studioPath, useCheatSheet, useClassSheets, useSheetFocus } from "./use-cheat-sheet";

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
 * THE CHEAT SHEET BESIDE A SESSION: docked on the window's right, as wide
 * as the learner drags it. It shows the session's deadline's sheet, else
 * the class's next one that has a sheet (a picker when there are several),
 * on the same canvas as the studio (pages one under another, fit to
 * width), with the same chat below it. A message sent from here takes the
 * problem or question the learner is on with it.
 */
export function SheetDock({
	classId,
	sessionDeadlineId,
	picked,
	onPick,
	about,
	onClose,
}: {
	classId: string;
	sessionDeadlineId: string | undefined;
	/** The deadline picked before in this session. */
	picked: string | undefined;
	onPick: (deadlineId: string) => void;
	about: SheetAbout | null;
	onClose: () => void;
}) {
	const [width, setWidth] = useState(DOCK_DEFAULT_W);
	useEffect(() => {
		const saved = Number(readStorage(WIDTH_KEY));
		setWidth(dockWidth(saved > 0 ? saved : DOCK_DEFAULT_W, window.innerWidth));
	}, []);
	const drag = useRef<{ x: number; w: number } | null>(null);

	const { view: cards, failed, reload } = useClassSheets(classId);
	const [making, setMaking] = useState<string | null>(null);
	const choices = cards ? sheetChoices(cards.cards) : [];
	const shown = cards ? (pickSheet(cards.cards, sessionDeadlineId, picked) ?? making) : null;
	const target = cards ? makeTarget(cards.cards, sessionDeadlineId) : null;
	const shownName = cards?.cards.find((c) => c.deadlineId === shown)?.name;

	return (
		<aside data-testid="sheet-dock" aria-label="Cheat sheet" style={{ width }} className="relative flex h-dvh shrink-0 flex-col border-l border-tone-2 bg-panel font-ui">
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Drag to resize the cheat sheet"
				data-testid="sheet-dock-resize"
				className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-tone-2"
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
			<header className="lh-drag flex h-14 shrink-0 items-center gap-3 border-b border-tone-2 pr-3 pl-5">
				{choices.length > 1 && shown ? (
					<select
						data-testid="sheet-dock-pick"
						aria-label="Which cheat sheet"
						value={shown}
						onChange={(e) => onPick(e.target.value)}
						className="lh-no-drag min-w-0 flex-1 truncate border border-tone-2 bg-panel px-2 py-1 text-[15px] font-bold text-ink"
					>
						{choices.map((c) => (
							<option key={c.deadlineId} value={c.deadlineId}>
								Cheat sheet for {c.name}
							</option>
						))}
					</select>
				) : (
					<span className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{shownName ? `Cheat sheet for ${shownName}` : "Cheat sheet"}</span>
				)}
				{shown && (
					<Link
						href={studioPath(shown)}
						data-testid="sheet-dock-studio"
						aria-label="Open the cheat sheet full size"
						title="Open full size"
						className="lh-no-drag lh-press flex size-8 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink"
					>
						<ArrowUpRightIcon className="size-4" aria-hidden />
					</Link>
				)}
				<button type="button" data-testid="sheet-dock-close" aria-label="Close the cheat sheet" onClick={onClose} className="lh-no-drag lh-press flex size-8 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink">
					<XIcon className="size-4" aria-hidden />
				</button>
			</header>
			{failed ? (
				<LoadFailed message="Couldn't load your cheat sheets." onRetry={() => void reload()} className="px-5 py-4" />
			) : !cards ? null : shown ? (
				<DockedSheet key={shown} classId={classId} deadlineId={shown} about={about} />
			) : (
				<div data-testid="sheet-dock-none" className="flex flex-col items-start gap-3 px-5 py-5 text-[14px] text-ink-2">
					<p>No cheat sheet yet.</p>
					{target ? (
						<button type="button" data-testid="sheet-dock-make" onClick={() => setMaking(target)} className="lh-press bg-ink px-4 py-2 text-[13.5px] font-bold text-background hover:bg-ink-max">
							Make one
						</button>
					) : (
						<p>Add a deadline to this class to make one.</p>
					)}
				</div>
			)}
		</aside>
	);
}

function DockedSheet({ classId, deadlineId, about }: { classId: string; deadlineId: string; about: SheetAbout | null }) {
	const { view, loadError, reload, act } = useCheatSheet(classId, deadlineId);
	const agent = useAgentStatus();
	const agentName = agent?.name ?? "Your agent";
	const { pointed, setPointed, focus, showVersion } = useSheetFocus();
	const pdfUrl = useCallback((n: number) => sheetPdfPath(classId, deadlineId, n), [classId, deadlineId]);
	if (loadError) return <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-5 py-4" />;
	if (!view) return null;
	const current = currentVersion(view.sheet);
	return (
		<>
			{current && (
				<div className="flex min-h-0 flex-[55] flex-col border-b border-tone-2">
					<SheetCanvas versions={[current]} pdfUrl={pdfUrl} labelFor={versionLabel} narrow focus={focus} onPoint={setPointed} />
				</div>
			)}
			<div className={current ? "flex min-h-[260px] flex-[45] flex-col" : "flex min-h-0 flex-1 flex-col"}>
				<SheetChat
					view={view}
					classId={classId}
					deadlineId={deadlineId}
					act={act}
					agentName={agentName}
					agentGone={!!agent && !agent.connected && !agent.teaching}
					pointed={pointed}
					onClearPointed={() => setPointed(null)}
					about={about}
					onShowVersion={current ? (n) => n === current.n && showVersion(n) : undefined}
					empty={current ? emptyChatLine(agentName, true) : `No cheat sheet yet for ${view.deadlineName}. ${emptyChatLine(agentName, false)}`}
				/>
			</div>
		</>
	);
}
