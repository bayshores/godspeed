import { useCallback, useState } from "react";
import { Link } from "react-router";
import { currentVersion, DEFAULT_TEACHER_NAME, type CheatSheetView } from "@/shared/core";
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
import { OlderSheet, emptyChatLine, sheetPaper, versionLabel } from "./studio-states";
import { remakeSheet, sheetPdfFile, sheetPdfPath, showSheetPdf, useCheatSheet, useSheetFocus } from "./use-cheat-sheet";

/**
 * THE CHEAT SHEET STUDIO: a page under the app's bar, whose crumb names the
 * sheet's deadline (a link back to it) and whose right side has the sheet's
 * paper, Show in Finder and Print. The canvas on
 * the left holds the PDF with the earlier versions beside it, or, before
 * there is a sheet, says what to ask for. On the right is the sheet's
 * chat: lines typed in the teacher's terminal ask about the sheet, a part
 * pointed at, or a change.
 */
export function CheatSheetStudio({ spaceId, deadlineId, deadlineName }: { spaceId: string; deadlineId: string; deadlineName: string }) {
	useJoinSpace(spaceId);

	const { view, loadError, reload, act } = useCheatSheet(spaceId, deadlineId);
	if (view) return <Studio view={view} spaceId={spaceId} deadlineId={deadlineId} act={act} />;
	return (
		<div className="flex h-full flex-col">
			<StudioHead deadlineId={deadlineId} deadlineName={deadlineName} />
			{loadError ? <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-8 py-6" /> : <div className="flex-1" aria-hidden />}
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

	return (
		<div className="flex h-full flex-col">
			<StudioHead deadlineId={deadlineId} deadlineName={view.deadlineName} />
			<BarActions>
				<span data-testid="cheat-sheet-status" className="shrink-0 px-2.5 text-[15px] text-bar-ink">
					{sheetPaper(view)}
				</span>
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
				<button type="button" data-testid="cheat-sheet-print" disabled={!current || printing} onClick={print} className={barWord(false)}>
					Print
				</button>
			</BarActions>
			{failed && (
				<p role="alert" className="shrink-0 px-8 pt-3 text-[15px] text-ans-wrong">
					{failed}
				</p>
			)}
			<div className="min-h-0 flex-1">
				<JobFrame doing={view.running ? (current ? "changing your sheet" : "making your sheet") : null}>
					<div className="flex h-full gap-6 px-8 pt-6 pb-7">
						<div className="lh-well flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded">
							{current ? (
								<SheetCanvas versions={view.sheet.versions} pdfUrl={pdfUrl} labelFor={versionLabel} focus={focus} onPoint={setPointed} />
							) : (
								<div data-testid="cheat-sheet-empty" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[18px] overflow-y-auto p-6 text-center">
									<div aria-hidden className="h-[220px] w-[170px] shrink-0 bg-background" />
									<h2 className="text-[28px] leading-tight text-ink">What do you want on your cheat sheet?</h2>
									<p className="max-w-[520px] text-lg leading-[1.45] text-ink-2">{emptyChatLine(teacherName, false)}</p>
									{view.sheet.olderFormat && !view.running && <OlderSheet onRemake={() => void remakeSheet(spaceId, deadlineId).then(setFailed)} />}
								</div>
							)}
						</div>
						<Pane data-testid="cheat-sheet-panel" className="flex w-[480px] shrink-0 flex-col overflow-hidden">
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
				</JobFrame>
			</div>
		</div>
	);
}
