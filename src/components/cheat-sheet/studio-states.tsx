import type { ReactNode } from "react";
import { PlugIcon, SquareTerminalIcon } from "lucide-react";
import { fitLabel, type CheatSheetView } from "@/core";
import { useReopenAgent } from "@/components/agent-folder/use-agent-folder";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cn } from "@/lib/utils";

const NO_AGENT = "No agent connected";

/** A dark card in the paper's place and size, for a sheet with nothing on it yet. */
export function PaperCard({ width, height, children }: { width: number; height: number; children: ReactNode }) {
	return (
		<div data-testid="cheat-sheet-card" className="flex flex-col items-center justify-center gap-4 bg-panel px-10 text-center outline outline-1 -outline-offset-1 outline-tone-2" style={{ width, height }}>
			{children}
		</div>
	);
}

/** No agent connected, before there is a sheet: the request waits for one. */
export function NoAgent({ width, height }: { width: number; height: number }) {
	const reopen = useReopenAgent();
	return (
		<PaperCard width={width} height={height}>
			<PlugIcon className="size-6 text-ink-2" aria-hidden />
			<h2 className="font-title text-[28px] text-ink">{NO_AGENT}</h2>
			<p className="max-w-[410px] font-prose text-[15px] leading-[22px] text-ink-2">
				Making your sheet takes one short request to an agent. Your rules and choices on the left are saved, so it starts right away once one connects.
			</p>
			<button
				type="button"
				data-testid="cheat-sheet-open-agent"
				disabled={reopen.busy}
				onClick={reopen.open}
				className="lh-press flex items-center gap-2.5 bg-ink px-4 py-[9px] text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-60"
			>
				<SquareTerminalIcon className="size-4" aria-hidden />
				{reopen.label}
			</button>
			{reopen.error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{reopen.error}
				</p>
			)}
			<p className="text-[12.5px] text-ink-3">{reopen.manual ? "Run the command from Settings, Connection in your terminal." : "Codex or any MCP agent works too."}</p>
		</PaperCard>
	);
}

/** The top bar's middle: what the agent is doing (or that none is
 *  connected to do it), or whether it fits. */
export function StudioStatus({
	view,
	agentName,
	agentGone,
	planned,
	fits,
	fill,
	showMeter,
	onStop,
}: {
	view: CheatSheetView;
	agentName: string;
	/** No agent connected: a request waits for one instead of running. */
	agentGone: boolean;
	planned: number;
	fits: boolean;
	fill: number;
	showMeter: boolean;
	onStop: () => void;
}) {
	const run = view.running;
	if (run) {
		const what =
			run.kind === "make"
				? `${agentName} is writing your sheet`
				: run.topicId
					? `${agentName} is adding a block`
					: `${agentName} is changing ${run.blockIds.length === 1 ? "a block" : `${run.blockIds.length} blocks`}`;
		return (
			<div data-testid="cheat-sheet-status" className="flex shrink-0 items-center gap-3 text-sm">
				{agentGone ? (
					<span className="font-bold text-ink">{NO_AGENT}</span>
				) : (
					<>
						<BrailleSpinner className="h-3.5 text-ink" />
						<span className="font-bold text-ink">{what}</span>
						{run.kind === "make" && <span className="text-ink-3">{planned} blocks</span>}
					</>
				)}
				<button type="button" onClick={onStop} className="lh-press font-bold text-ink-2 hover:text-ink">
					Stop
				</button>
			</div>
		);
	}
	if (!showMeter)
		return (
			<span data-testid="cheat-sheet-status" className="shrink-0 text-sm text-ink-2">
				{view.sheet.blocks.length === 0 ? "Not made yet" : ""}
			</span>
		);
	const percent = Math.round(fill * 100);
	return (
		<div data-testid="cheat-sheet-status" className="flex shrink-0 items-center gap-3 text-sm">
			<span className={cn("font-bold", fits ? "text-ink" : "text-ans-wrong")}>{fitLabel(view.sheet.rules.paper, fits)}</span>
			<span className="relative h-1.5 w-[140px] bg-tone-2" role="meter" aria-label="How full the paper is" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
				<span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, percent)}%`, background: fits ? "var(--lh-ramp-5)" : "var(--lh-ramp-1)" }} />
			</span>
			<span className="w-10 font-mono text-[12.5px] text-ink-2 tabular-nums">{percent}%</span>
		</div>
	);
}
