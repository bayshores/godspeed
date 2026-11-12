import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { CARD } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { Shimmer } from "@/frontend/components/ai-elements/shimmer";
import { toolActivityLabel } from "@/shared/core";
import type { ArtifactPartProps } from "@/shared/core";

/**
 * The LIVE tool-input card: what a tool call looks like while the agent
 * WRITES it. A tool part sits in `input-streaming` for its whole execution
 * (the bridge defers input-available to tool_execution_end), so this card
 * IS the working state: spinner + shimmered activity label in the header,
 * and the streaming input itself watchable on expand. The moment the call
 * settles, the part re-renders through the artifact registry and the
 * quiet settled card replaces this one.
 *
 * The one working-state look everywhere: Braille spinner + Shimmer (the
 * thinking row, this card, the sidebar row).
 */
interface StreamingToolPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
}

export function LiveToolCard({ part }: ArtifactPartProps) {
	const p = part as StreamingToolPart;
	const tool = p.type.replace(/^tool-/, "");
	const inp = (p.input ?? {}) as Record<string, unknown>;
	// The headline argument (ToolCallCard's rule, shown as given): path for
	// read/ls, pattern for find/grep.
	let arg = "";
	if (typeof inp.path === "string" && inp.path) arg = inp.path;
	else if (typeof inp.pattern === "string" && inp.pattern) arg = inp.pattern;

	const hasInput = p.input != null && Object.keys(inp).length > 0;

	return (
		<details
			data-testid="live-tool-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2.5 text-[15px] text-ink-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-ink [&::-webkit-details-marker]:hidden">
				<BrailleSpinner label={`${toolActivityLabel(tool)} (live)`} />
				<Shimmer className="text-[15px]">
					{toolActivityLabel(tool)}
				</Shimmer>
				{arg && <span className="truncate" title={arg}>{arg}</span>}
				<PixelIcon name="chevron" className="shrink-0 transition-transform duration-(--lh-dur) ease-(--lh-ease-out) group-open:rotate-90" />
			</summary>
			<div className={cn(CARD, "mt-2 flex flex-col gap-1.5 py-3")}>
				<div className="text-[15px] text-ink-2">Input (streaming)</div>
				<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-ink">
					{hasInput ? JSON.stringify(p.input, null, 2) : "…"}
				</pre>
			</div>
		</details>
	);
}
