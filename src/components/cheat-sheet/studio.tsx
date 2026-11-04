"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon, PrinterIcon } from "lucide-react";
import { fitPrompt, overflowLine, pageSizeCss, type ChatAttachment, type CheatSheetView } from "@/core";
import { NoAgentLine } from "@/components/agent-folder/no-agent-line";
import { useAgentStatus } from "@/components/agent-status";
import { useClasses } from "@/components/class-context";
import { LoadFailed } from "@/components/load-failed";
import { useFoldSidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { PromptBox, PromptHistory } from "./prompt-box";
import { SheetPages } from "./sheet-pages";
import { StudioStatus } from "./studio-states";
import { useCheatSheet } from "./use-cheat-sheet";

const NEWER = "A newer godspeed saved this cheat sheet. Update godspeed to change it.";

/**
 * THE CHEAT SHEET STUDIO: a page of its own with the sidebar folded away.
 * Before there is a sheet, one box asks what should go on it. Then the
 * pages sit in the middle at their true proportions, and the side panel
 * keeps what the learner asked and the box for the next change. The top
 * bar says what the agent is doing and whether the sheet fits, and prints
 * it or saves a PDF at the agent's page size.
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
				<Studio view={view} deadlineId={deadlineId} act={act} />
			) : (
				<>
					<TopBar />
					{loadError ? <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-[52px] py-6" /> : <div className="flex-1" aria-hidden />}
				</>
			)}
		</div>
	);
}

function Studio({ view, deadlineId, act }: { view: CheatSheetView; deadlineId: string; act: (body: Record<string, unknown>) => Promise<string | null> }) {
	const agent = useAgentStatus();
	const agentName = agent?.name ?? "Your agent";
	const agentGone = !!agent && !agent.connected && !agent.teaching;
	const [over, setOver] = useState<number[]>([]);
	const [failed, setFailed] = useState<string | null>(null);
	const doc = view.sheet.doc;
	const run = view.running;
	const title = `${view.className} ${view.deadlineName}`;

	const ask = useCallback(
		(text: string, files: ChatAttachment[]) => act({ action: "ask", text, ...(files.length > 0 ? { attachments: files } : {}) }),
		[act],
	);
	const post = (body: Record<string, unknown>) => void act(body).then(setFailed);
	const savePdf = typeof window !== "undefined" ? window.lh?.savePdf : undefined;

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

	return (
		<>
			{doc && <style>{`@page { size: ${pageSizeCss(doc)}; margin: 0; }`}</style>}
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
				<StudioStatus view={view} agentName={agentName} agentGone={agentGone} over={over} onStop={() => post({ action: "stop" })} />
				{savePdf && (
					<button
						type="button"
						data-testid="cheat-sheet-save-pdf"
						disabled={!doc}
						onClick={() => void savePdf(`${title} cheat sheet`)}
						className="lh-press flex items-center gap-2 bg-panel px-3 py-[7px] text-sm text-ink hover:bg-tone disabled:opacity-40"
					>
						<DownloadIcon className="size-4" aria-hidden />
						Save as PDF
					</button>
				)}
				<button
					type="button"
					data-testid="cheat-sheet-print"
					disabled={!doc}
					onClick={() => window.print()}
					className="lh-press flex items-center gap-2 bg-ink px-4 py-[7px] text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-40"
				>
					<PrinterIcon className="size-4" aria-hidden />
					Print
				</button>
			</TopBar>
			{doc ? (
				<div className="flex min-h-0 flex-1">
					<SheetPages doc={doc} onOverflow={setOver} />
					<aside data-testid="cheat-sheet-panel" className="flex w-[340px] shrink-0 flex-col border-l border-tone-2">
						<div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-6">
							<h2 className="mb-3 text-[13px] font-bold text-ink-2">What you asked</h2>
							{history}
						</div>
						<div className="flex shrink-0 flex-col gap-3 px-[22px] pb-[22px]">
							{over.length > 0 && !run && !view.newer && (
								<div data-testid="cheat-sheet-fit" role="status" className="flex flex-col gap-2.5 px-3.5 py-3 outline outline-1 -outline-offset-1 outline-(--lh-ramp-1)">
									<p className="flex items-center gap-2.5 text-sm font-bold text-ink">
										<span className="size-2.5 shrink-0 bg-(--lh-ramp-1)" aria-hidden />
										{overflowLine(over, doc.pages.length)}
									</p>
									<button
										type="button"
										data-testid="cheat-sheet-make-fit"
										onClick={() => void ask(fitPrompt(over, doc.pages.length), []).then(setFailed)}
										className="lh-press bg-tone px-2.5 py-2 text-left text-[13px] font-bold text-ink hover:bg-tone-2"
									>
										Make it fit
									</button>
								</div>
							)}
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
							<p className="text-[15px] text-ink-2">{agentName} reads your class&apos;s rules in the syllabus and puts your weak topics and mistakes first.</p>
						</div>
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
