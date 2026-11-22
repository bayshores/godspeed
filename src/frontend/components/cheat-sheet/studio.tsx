import { useCallback, useState } from "react";
import { LoadingBox } from "@/frontend/components/loading";
import { Link } from "react-router";
import { currentVersion, DEFAULT_TEACHER_NAME, pageSizeLabel, type CheatSheetView } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useJoinSpace } from "@/frontend/components/use-join-space";
import { LoadFailed } from "@/frontend/components/load-failed";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { BarActions, BarCrumb, CrumbName } from "@/frontend/components/top-bar/bar-slots";
import { Pane } from "@/frontend/components/ui/pane";
import { printPdf } from "./print-pdf";
import { SheetCanvas } from "./sheet-canvas";
import { SheetChat } from "./sheet-chat";
import { JobFrame } from "@/frontend/components/work/job-frame";
import { OlderSheet, emptyChatLine, versionLabel } from "./studio-states";
import { remakeSheet, sheetPdfFile, sheetPdfPath, showSheetPdf, useCheatSheet, useSheetFocus } from "./use-cheat-sheet";

/**
 * THE CHEAT SHEET STUDIO: a page under the app's bar, whose crumb names the
 * sheet's deadline (a link back to it) and whose right side has, once the
 * sheet is made, Show in Finder and Print. The canvas on
 * the left holds the PDF with the earlier versions beside it, or, before
 * there is a sheet, says what to ask for over the box that asks. On the
 * right is the sheet's chat, once something is in it: its box asks about
 * the sheet, a part pointed at, or a change.
 */
export function CheatSheetStudio({ spaceId, deadlineId, deadlineName }: { spaceId: string; deadlineId: string; deadlineName: string }) {
	useJoinSpace(spaceId);

	const { view, loadError, reload, act } = useCheatSheet(spaceId, deadlineId);
	if (view) return <Studio view={view} spaceId={spaceId} deadlineId={deadlineId} act={act} />;
	return (
		<div className="flex h-full flex-col">
			<StudioHead deadlineId={deadlineId} deadlineName={deadlineName} />
			{loadError ? <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-8 py-6" /> : <LoadingBox className="flex-1" />}
		</div>
	);
}

/** The studio's name: the bar's crumb "<deadline> › Cheat sheet", the deadline a link back to it, and the page's hidden h1. */
function StudioHead({ deadlineId, deadlineName }: { deadlineId: string; deadlineName: string }) {
	return (
		<>
			<h1 className="sr-only">Cheat sheet for {deadlineName}</h1>
			<BarCrumb>
				<Link to={`/space/deadline/${encodeURIComponent(deadlineId)}`} data-testid="studio-deadline" title={deadlineName} className="flex hover:underline">
					<CrumbName text={deadlineName} />
				</Link>
				<span aria-hidden className="shrink-0">
					›
				</span>
				<span className="shrink-0 whitespace-nowrap">Cheat sheet</span>
			</BarCrumb>
		</>
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
	const teacherName = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const [failed, setFailed] = useState<string | null>(null);
	const [printing, setPrinting] = useState(false);
	const { pointed, setPointed, focus, showVersion } = useSheetFocus();
	const current = currentVersion(view.sheet);
	const fileName = `${view.spaceName} ${view.deadlineName} cheat sheet`;
	const pdfUrl = useCallback((n: number) => sheetPdfPath(spaceId, deadlineId, n), [spaceId, deadlineId]);
	const currentUrl = current ? pdfUrl(current.n) : null;
	const desktop = typeof window !== "undefined" && !!window.lh?.showInFolder;
	const fileButton = barWord(false);
	// The Mac prints the PDF file itself through the system's sheet; elsewhere pdf.js draws it.
	const printVersion = async (n: number, url: string) => {
		const printFile = window.lh?.printPdf;
		if (!printFile) return printPdf(url);
		const file = await sheetPdfFile(spaceId, deadlineId, n);
		if ("error" in file) throw new Error(file.error);
		await printFile(file.path);
	};
	const print = () => {
		if (!current || !currentUrl) return;
		setPrinting(true);
		printVersion(current.n, currentUrl)
			.catch((err: unknown) => setFailed(`Couldn't print: ${err instanceof Error ? err.message : String(err)}`))
			.finally(() => setPrinting(false));
	};

	// Before anything is asked the page is the question alone: a chat with nothing in it gets no column.
	const quiet = !current && view.sheet.messages.length === 0 && view.sheet.rules.length === 0;
	const chat = (
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
			empty={current ? emptyChatLine(true) : undefined}
			bare={quiet}
		/>
	);

	return (
		<div className="flex h-full flex-col">
			<StudioHead deadlineId={deadlineId} deadlineName={view.deadlineName} />
			{current && currentUrl && (
				<BarActions>
					{desktop ? (
						<button type="button" data-testid="cheat-sheet-show-file" onClick={() => void showSheetPdf(spaceId, deadlineId, current.n).then(setFailed)} className={fileButton}>
							Show in {fileBrowserName(window.lh?.platform)}
						</button>
					) : (
						<a data-testid="cheat-sheet-download" href={currentUrl} download={`${fileName}.pdf`} className={fileButton}>
							Download PDF
						</a>
					)}
					<button type="button" data-testid="cheat-sheet-print" disabled={printing} onClick={print} className={barWord(false)}>
						Print
					</button>
				</BarActions>
			)}
			{failed && (
				<p role="alert" className="shrink-0 px-8 pt-3 text-[15px] text-ans-wrong">
					{failed}
				</p>
			)}
			<div className="min-h-0 flex-1">
				<JobFrame doing={view.running ? (current ? "changing your sheet" : "making your sheet") : null}>
					{/* Side by side where both fit; in less room the sheet is over its chat. */}
					<div className="@container flex h-full flex-col">
						<div className="flex min-h-0 flex-1 flex-col gap-6 px-8 pt-6 pb-7 @[768px]:flex-row">
							<div className="lh-well flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded">
								{current ? (
									<SheetCanvas versions={view.sheet.versions} pdfUrl={pdfUrl} labelFor={versionLabel} focus={focus} onPoint={setPointed} paper={pageSizeLabel(current.pages)} />
								) : (
									<div data-testid="cheat-sheet-empty" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-x-14 gap-y-6 overflow-y-auto p-8 @[900px]:flex-row">
										{/* The paper the sheet will be on, still blank. */}
										<div aria-hidden className="hidden aspect-[17/22] h-[min(78%,620px)] shrink-0 bg-white @[900px]:block" />
										<div className="flex w-full max-w-[520px] flex-col gap-[18px]">
											<h2 className="text-[34px] leading-[1.15] text-ink">What do you want on your cheat sheet?</h2>
											<p className="text-lg leading-[1.45] text-ink-2">{emptyChatLine(false)}</p>
											{quiet && chat}
											{view.sheet.olderFormat && !view.running && <OlderSheet onRemake={() => void remakeSheet(spaceId, deadlineId).then(setFailed)} />}
										</div>
									</div>
								)}
							</div>
							{!quiet && (
								<Pane data-testid="cheat-sheet-panel" data-fills="a chat log fills its column" className="flex max-h-[40%] shrink-0 flex-col overflow-hidden @[768px]:max-h-none @[768px]:w-[clamp(340px,40%,480px)]">
									{chat}
								</Pane>
							)}
						</div>
					</div>
				</JobFrame>
			</div>
		</div>
	);
}
