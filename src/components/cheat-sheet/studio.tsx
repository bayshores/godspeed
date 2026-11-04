"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon, FolderOpenIcon, PrinterIcon } from "lucide-react";
import { currentVersion, type ChatAttachment, type CheatSheetView, type SheetVersion } from "@/core";
import { NoAgentLine } from "@/components/agent-folder/no-agent-line";
import { useAgentStatus } from "@/components/agent-status";
import { useClasses } from "@/components/class-context";
import { LoadFailed } from "@/components/load-failed";
import { useFoldSidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { fileBrowserName } from "@/components/files/files-model";
import { printPdf } from "./print-pdf";
import { PromptBox, PromptHistory } from "./prompt-box";
import { SheetCanvas } from "./sheet-canvas";
import { OlderSheet, StudioStatus } from "./studio-states";
import { remakeSheet, sheetPdfPath, showSheetPdf, useCheatSheet } from "./use-cheat-sheet";

const NEWER = "A newer godspeed saved this cheat sheet. Update godspeed to change it.";
/** The floating panel's width and its gap from the canvas's edges. */
const PANEL_W = 340;
const PANEL_GAP = 16;

/**
 * THE CHEAT SHEET STUDIO: a page of its own with the sidebar folded away.
 * Before there is a sheet, one box asks what should go on it. Then the
 * PDF the agent made sits on a canvas with the earlier versions beside it,
 * and a panel floating on the right keeps what the learner asked and the
 * box for the next change. The top bar says what the agent is doing and
 * the paper, saves a copy of the PDF and prints it.
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

const when = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The line above a version on the canvas. */
function versionLabel(v: SheetVersion, newest: boolean): string {
	return `${newest ? "Current" : when(v.at)} · ${v.prompt || "From the files you sent"}`;
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
	const current = currentVersion(view.sheet);
	const run = view.running;
	const fileName = `${view.className} ${view.deadlineName} cheat sheet`;
	const pdfUrl = useCallback((n: number) => sheetPdfPath(classId, deadlineId, n), [classId, deadlineId]);
	const currentUrl = current ? pdfUrl(current.n) : null;

	const ask = useCallback(
		(text: string, files: ChatAttachment[]) => act({ action: "ask", text, ...(files.length > 0 ? { attachments: files } : {}) }),
		[act],
	);
	const post = (body: Record<string, unknown>) => void act(body).then(setFailed);
	const desktop = typeof window !== "undefined" && !!window.lh?.showInFolder;
	const print = () => {
		if (!currentUrl) return;
		setPrinting(true);
		printPdf(currentUrl)
			.catch((err: unknown) => setFailed(`Couldn't print: ${err instanceof Error ? err.message : String(err)}`))
			.finally(() => setPrinting(false));
	};

	const history = (
		<PromptHistory prompts={view.sheet.prompts} running={run?.prompt ?? null} error={view.error} agentName={agentName} waiting={agentGone} onRetry={() => post({ action: "retry" })} />
	);
	const notes = (
		<>
			{(failed || view.newer) && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{view.newer ? NEWER : failed}
				</p>
			)}
			<NoAgentLine />
		</>
	);
	const box = (label: string, placeholder: string) => (
		<PromptBox deadlineId={deadlineId} label={label} placeholder={placeholder} running={run?.prompt ?? null} disabled={view.newer} onSend={ask} onStop={() => post({ action: "stop" })} />
	);
	const fileClass = "lh-press flex items-center gap-2 bg-panel px-3 py-[7px] text-sm text-ink hover:bg-tone";

	return (
		<>
			<TopBar>
				<nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
					<Link href={`/class/deadline/${encodeURIComponent(deadlineId)}`} className="lh-press flex min-w-0 items-center gap-2 text-ink-2 hover:text-ink">
						<ArrowLeftIcon className="size-4 shrink-0" aria-hidden />
						<span className="truncate">
							{view.className} · {view.deadlineName}
						</span>
					</Link>
					<span className="shrink-0 font-bold text-ink">Cheat sheet</span>
				</nav>
				<StudioStatus view={view} agentName={agentName} agentGone={agentGone} onStop={() => post({ action: "stop" })} />
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
			{current ? (
				<div className="relative flex min-h-0 flex-1">
					<SheetCanvas versions={view.sheet.versions} pdfUrl={pdfUrl} labelFor={versionLabel} inset={PANEL_W + 2 * PANEL_GAP} />
					<aside
						data-testid="cheat-sheet-panel"
						className="absolute flex flex-col bg-panel outline outline-1 -outline-offset-1 outline-tone-2"
						style={{ top: PANEL_GAP, right: PANEL_GAP, bottom: PANEL_GAP, width: PANEL_W }}
					>
						<div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-6">
							<h2 className="mb-3 text-[13px] font-bold text-ink-2">What you asked</h2>
							{history}
						</div>
						<div className="flex shrink-0 flex-col gap-3 px-[22px] pb-[22px]">
							{notes}
							{box("Send", `Tell ${agent?.name ?? "your agent"} what to change`)}
						</div>
					</aside>
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto flex w-full max-w-[712px] flex-col gap-7 px-4 pt-[92px] pb-16">
						<div className="flex flex-col gap-2">
							<h2 className="font-title text-[34px] leading-tight font-bold text-ink">What do you want on your cheat sheet?</h2>
							<p className="text-[15px] text-ink-2">{agentName} reads your class&apos;s rules in the syllabus, puts your weak topics and mistakes first, and makes it as a PDF.</p>
						</div>
						{view.sheet.olderFormat && !run && <OlderSheet onRemake={() => void remakeSheet(classId, deadlineId).then(setFailed)} />}
						{history}
						<div className="flex flex-col gap-3">
							{box("Make", "For example, both sides of A4 with every formula so far and a flowchart for any counting problem")}
							{notes}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
