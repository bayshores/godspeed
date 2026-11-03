import type { ReactNode } from "react";
import { PlugIcon, SquareTerminalIcon } from "lucide-react";
import { useReopenAgent } from "@/components/agent-folder/use-agent-folder";

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
			<h2 className="font-title text-[28px] text-ink">No agent connected</h2>
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
