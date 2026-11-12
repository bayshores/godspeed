"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { currentVersion, DEFAULT_TEACHER_NAME, type CheatSheetView } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useSpaces } from "@/frontend/components/space-context";
import { LoadFailed } from "@/frontend/components/load-failed";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { printPdf } from "./print-pdf";
import { SheetCanvas } from "./sheet-canvas";
import { SheetChat } from "./sheet-chat";
import { TeacherHead } from "@/frontend/components/halley/teacher-head";
import { OlderSheet, emptyChatLine, sheetPaper, teacherDoing, versionLabel } from "./studio-states";
import { remakeSheet, sheetPdfPath, showSheetPdf, useCheatSheet, useSheetFocus } from "./use-cheat-sheet";

/**
 * THE CHEAT SHEET STUDIO: a page of its own under a dark bar (back to the
 * deadline, the sheet's paper, Show in Finder, Print). The canvas on the
 * left holds the PDF with the earlier versions beside it, or, before there
 * is a sheet, says what to ask for. The teacher side on the right is the
 * sheet's chat: ask about the sheet, point at part of it, or ask for a change.
 */
export function CheatSheetStudio({ spaceId, deadlineId, deadlineName }: { spaceId: string; deadlineId: string; deadlineName: string }) {
	const router = useRouter();
	const { active, setActive } = useSpaces();
	const [joined, setJoined] = useState(active === spaceId);
	useEffect(() => {
		if (!joined) {
			if (active === spaceId) setJoined(true);
			else setActive(spaceId);
		} else if (active !== spaceId) router.replace("/space");
	}, [active, spaceId, joined, setActive, router]);

	const { view, loadError, reload, act } = useCheatSheet(spaceId, deadlineId);
	if (view) return <Studio view={view} spaceId={spaceId} deadlineId={deadlineId} act={act} />;
	return (
		<div className="flex h-full flex-col">
			<StudioBar deadlineId={deadlineId} deadlineName={deadlineName} />
			{loadError ? <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-8 py-6" /> : <div className="flex-1" aria-hidden />}
		</div>
	);
}

/** The studio's own bar, in place of the app's top bar (so it is the window's
 *  drag band too): the way back, the sheet's name, then its status and buttons. */
function StudioBar({ deadlineId, deadlineName, status, children }: { deadlineId: string; deadlineName: string; status?: string; children?: ReactNode }) {
	return (
		<div data-testid="studio-bar" className="lh-own-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-center gap-4 bg-bar px-6 text-bar-ink">
			<Link href={`/space/deadline/${encodeURIComponent(deadlineId)}`} prefetch={false} data-testid="page-back" className="lh-btn lh-btn-bar max-w-[28ch] px-3">
				<PixelIcon name="chevron" className="-scale-x-100" />
				<span className="truncate">{deadlineName}</span>
			</Link>
			<h1 className="min-w-0 flex-1 truncate text-lg font-medium">Cheat sheet for {deadlineName}</h1>
			{status && (
				<span data-testid="cheat-sheet-status" className="shrink-0 text-base">
					{status}
				</span>
			)}
			{children}
		</div>
	);
}

function Studio({
	view,
	spaceId,
	deadlineId,
	act,
}: {
	view: CheatSheetView;
	spaceId: string;
	deadlineId: string;
	act: (body: Record<string, unknown>) => Promise<string | null>;
}) {
	const agent = useAgentStatus();
	const agentGone = !!agent && !agent.connected && !agent.teaching;
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const { activeSpace } = useSpaces();
	const [failed, setFailed] = useState<string | null>(null);
	const [printing, setPrinting] = useState(false);
	const { pointed, setPointed, focus, showVersion } = useSheetFocus();
	const current = currentVersion(view.sheet);
	const fileName = `${view.spaceName} ${view.deadlineName} cheat sheet`;
	const pdfUrl = useCallback((n: number) => sheetPdfPath(spaceId, deadlineId, n), [spaceId, deadlineId]);
	const currentUrl = current ? pdfUrl(current.n) : null;
	const desktop = typeof window !== "undefined" && !!window.lh?.showInFolder;
	const fileButton = "lh-btn lh-btn-quiet shrink-0 px-2 text-[15px] font-normal text-bar-ink hover:bg-bar-ink/15 hover:text-bar-ink";
	const print = () => {
		if (!currentUrl) return;
		setPrinting(true);
		printPdf(currentUrl)
			.catch((err: unknown) => setFailed(`Couldn't print: ${err instanceof Error ? err.message : String(err)}`))
			.finally(() => setPrinting(false));
	};

	return (
		<div className="flex h-full flex-col">
			<StudioBar deadlineId={deadlineId} deadlineName={view.deadlineName} status={sheetPaper(view)}>
				{current &&
					currentUrl &&
					(desktop ? (
						<button type="button" data-testid="cheat-sheet-show-file" onClick={() => void showSheetPdf(spaceId, deadlineId, current.n).then(setFailed)} className={fileButton}>
							Show in {fileBrowserName(window.lh?.platform)}
						</button>
					) : (
						<a data-testid="cheat-sheet-download" href={currentUrl} download={`${fileName}.pdf`} className={fileButton}>
							Download PDF
						</a>
					))}
				<button type="button" data-testid="cheat-sheet-print" disabled={!current || printing} onClick={print} className="lh-btn lh-btn-bar">
					Print
				</button>
			</StudioBar>
			{failed && (
				<p role="alert" className="shrink-0 px-8 pt-3 text-[15px] text-ans-wrong">
					{failed}
				</p>
			)}
			<div className="flex min-h-0 flex-1 gap-6 px-8 pt-6 pb-7">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col border border-border">
					{current ? (
						<SheetCanvas versions={view.sheet.versions} pdfUrl={pdfUrl} labelFor={versionLabel} focus={focus} onPoint={setPointed} />
					) : (
						<div data-testid="cheat-sheet-empty" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[18px] overflow-y-auto p-6 text-center">
							<div aria-hidden className="h-[220px] w-[170px] shrink-0 border border-border bg-background" />
							<h2 className="text-[28px] leading-tight text-ink">What do you want on your cheat sheet?</h2>
							<p className="max-w-[520px] text-lg leading-[1.45] text-ink-2">{emptyChatLine(teacherName, false)}</p>
							{view.sheet.olderFormat && !view.running && <OlderSheet onRemake={() => void remakeSheet(spaceId, deadlineId).then(setFailed)} />}
						</div>
					)}
				</div>
				<Pane data-testid="cheat-sheet-panel" className="flex w-[480px] shrink-0 flex-col overflow-hidden">
					<TeacherHead name={teacherName} color={activeSpace?.id === spaceId ? activeSpace.color : undefined} doing={teacherDoing(view, agentGone)} />
					<SheetChat
						view={view}
						spaceId={spaceId}
						deadlineId={deadlineId}
						act={act}
						agentName={teacherName}
						agentGone={agentGone}
						pointed={pointed}
						onClearPointed={() => setPointed(null)}
						onShowVersion={current ? showVersion : undefined}
						empty={current ? emptyChatLine(teacherName, true) : undefined}
					/>
				</Pane>
			</div>
		</div>
	);
}
