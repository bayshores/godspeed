"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon, FolderOpenIcon, PrinterIcon } from "lucide-react";
import { currentVersion, type CheatSheetView } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useClasses } from "@/frontend/components/class-context";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useFoldSidebar } from "@/frontend/components/sidebar";
import { TopBar } from "@/frontend/components/top-bar";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { printPdf } from "./print-pdf";
import { SheetCanvas } from "./sheet-canvas";
import { SheetChat } from "./sheet-chat";
import { OlderSheet, StudioStatus, emptyChatLine, versionLabel } from "./studio-states";
import { remakeSheet, sheetPdfPath, showSheetPdf, useCheatSheet, useSheetFocus } from "./use-cheat-sheet";

/** The floating panel's width and its gap from the canvas's edges. */
const PANEL_W = 380;
const PANEL_GAP = 16;

/**
 * THE CHEAT SHEET STUDIO: a page of its own with the sidebar folded away.
 * Before there is a sheet, the sheet's chat asks what should go on it.
 * Then the PDF sits on a canvas with the earlier versions beside it, and
 * the chat floats on the right: ask about the sheet, point at part of it,
 * or ask for a change. The top bar says what the agent is doing and the
 * paper, shows the PDF in Finder and prints it.
 */
export function CheatSheetStudio({ classId, deadlineId }: { classId: string; deadlineId: string }) {
	useFoldSidebar();
	const router = useRouter();
	const { active, setActive } = useClasses();
	const [joined, setJoined] = useState(active === classId);
	useEffect(() => {
		if (!joined) {
			if (active === classId) setJoined(true);
			else setActive(classId);
		} else if (active !== classId) router.replace("/class");
	}, [active, classId, joined, setActive, router]);

	const { view, loadError, reload, act } = useCheatSheet(classId, deadlineId);
	return (
		<div className="flex h-full flex-col">
			{view ? (
				<Studio view={view} classId={classId} deadlineId={deadlineId} act={act} />
			) : (
				<>
					<TopBar />
					{loadError ? <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-[52px] py-6" /> : <div className="flex-1" aria-hidden />}
				</>
			)}
		</div>
	);
}

function Studio({
	view,
	classId,
	deadlineId,
	act,
}: {
	view: CheatSheetView;
	classId: string;
	deadlineId: string;
	act: (body: Record<string, unknown>) => Promise<string | null>;
}) {
	const agent = useAgentStatus();
	const agentName = agent?.name ?? "Your agent";
	const agentGone = !!agent && !agent.connected && !agent.teaching;
	const [failed, setFailed] = useState<string | null>(null);
	const [printing, setPrinting] = useState(false);
	const { pointed, setPointed, focus, showVersion } = useSheetFocus();
	const current = currentVersion(view.sheet);
	const fileName = `${view.className} ${view.deadlineName} cheat sheet`;
	const pdfUrl = useCallback((n: number) => sheetPdfPath(classId, deadlineId, n), [classId, deadlineId]);
	const currentUrl = current ? pdfUrl(current.n) : null;
	const desktop = typeof window !== "undefined" && !!window.lh?.showInFolder;
	const print = () => {
		if (!currentUrl) return;
		setPrinting(true);
		printPdf(currentUrl)
			.catch((err: unknown) => setFailed(`Couldn't print: ${err instanceof Error ? err.message : String(err)}`))
			.finally(() => setPrinting(false));
	};

	const chat = (
		<SheetChat
			view={view}
			classId={classId}
			deadlineId={deadlineId}
			act={act}
			agentName={agentName}
			agentGone={agentGone}
			pointed={pointed}
			onClearPointed={() => setPointed(null)}
			onShowVersion={current ? showVersion : undefined}
			empty={emptyChatLine(agentName, !!current)}
		/>
	);
	const fileClass = "lh-press flex items-center gap-2 bg-panel px-3 py-[7px] text-sm text-ink hover:bg-tone";

	return (
		<>
			<TopBar>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<Link
						href={`/class/deadline/${encodeURIComponent(deadlineId)}`}
						aria-label={`Back to ${view.deadlineName}`}
						title={`Back to ${view.deadlineName}`}
						className="lh-press flex size-8 shrink-0 items-center justify-center text-ink-2 hover:bg-tone hover:text-ink"
					>
						<ArrowLeftIcon className="size-4" aria-hidden />
					</Link>
					<h1 className="min-w-0 truncate text-[15px] font-bold text-ink">Cheat sheet for {view.deadlineName}</h1>
				</div>
				<StudioStatus view={view} agentName={agentName} agentGone={agentGone} onStop={() => void act({ action: "stop" }).then(setFailed)} />
				{current &&
					currentUrl &&
					(desktop ? (
						<button
							type="button"
							data-testid="cheat-sheet-show-file"
							onClick={() => void showSheetPdf(classId, deadlineId, current.n).then(setFailed)}
							className={fileClass}
						>
							<FolderOpenIcon className="size-4" aria-hidden />
							Show in {fileBrowserName(window.lh?.platform)}
						</button>
					) : (
						<a data-testid="cheat-sheet-download" href={currentUrl} download={`${fileName}.pdf`} className={fileClass}>
							<DownloadIcon className="size-4" aria-hidden />
							Download PDF
						</a>
					))}
				<button
					type="button"
					data-testid="cheat-sheet-print"
					disabled={!current || printing}
					onClick={print}
					className="lh-press flex items-center gap-2 bg-ink px-4 py-[7px] text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-40"
				>
					<PrinterIcon className="size-4" aria-hidden />
					Print
				</button>
			</TopBar>
			{failed && (
				<p role="alert" className="shrink-0 px-[52px] pb-2 text-[13px] text-ans-wrong">
					{failed}
				</p>
			)}
			{current ? (
				<div className="relative flex min-h-0 flex-1">
					<SheetCanvas versions={view.sheet.versions} pdfUrl={pdfUrl} labelFor={versionLabel} inset={PANEL_W + 2 * PANEL_GAP} focus={focus} onPoint={setPointed} />
					<aside
						data-testid="cheat-sheet-panel"
						className="absolute flex flex-col bg-panel outline outline-1 -outline-offset-1 outline-tone-2"
						style={{ top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, width: PANEL_W }}
					>
						{chat}
					</aside>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto flex h-full w-full max-w-[712px] flex-col gap-7 px-4 pt-[72px] pb-10">
						<h2 className="font-title text-[34px] leading-tight font-bold text-ink">What do you want on your cheat sheet?</h2>
						{view.sheet.olderFormat && !view.running && <OlderSheet onRemake={() => void remakeSheet(classId, deadlineId).then(setFailed)} />}
						<div data-testid="cheat-sheet-panel" className="flex min-h-[420px] flex-1 flex-col bg-panel outline outline-1 -outline-offset-1 outline-tone-2">
							{chat}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
