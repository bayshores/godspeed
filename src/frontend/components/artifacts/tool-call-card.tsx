import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { CARD } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import type { ArtifactPartProps } from "@/shared/core";

/**
 * The generic tool-call card: a quiet, collapsed one-liner per
 * synchronous tool call (a plain verb plus the headline argument, e.g.
 * read's file name), expandable to the full input and output. Unregistered tools
 * still render nothing (lesson/message-row.tsx's registry default); this card is only
 * for the learner-filesystem set (read/ls/find/grep) where the call IS
 * worth a trace in the transcript.
 */

interface ToolCallPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

/** The collapsed headline argument per tool: path for read/ls, pattern for
 *  find/grep — shown as given, never resolved (the absolute path lands in
 *  the expanded view when present in the output). */
function headlineArg(tool: string, input: unknown): string {
	const inp = (input ?? {}) as Record<string, unknown>;
	if (tool === "read" || tool === "ls") {
		const p = typeof inp.path === "string" && inp.path.length > 0 ? inp.path : "~";
		return p;
	}
	return typeof inp.pattern === "string" ? inp.pattern : "";
}

/** The collapsed line's verb per tool, in plain words. */
const DONE_LABEL: Record<string, string> = { read: "Read", ls: "Looked in", find: "Found files", grep: "Searched for" };

/** Render a tool result body: plain strings verbatim, image-bearing read
 *  results show their text + an attachment note (the image itself is the
 *  model's — the learner sees only that it happened). */
function outputText(output: unknown): string | null {
	if (output == null) return null;
	if (typeof output === "string") return output;
	if (typeof output === "object" && "text" in (output as Record<string, unknown>)) {
		const o = output as { text?: unknown; images?: unknown[] };
		const text = typeof o.text === "string" ? o.text : null;
		const n = Array.isArray(o.images) ? o.images.length : 0;
		return n > 0 ? `${text ?? ""}\n[${n} image${n > 1 ? "s" : ""} attached to the model]`.trim() : text;
	}
	try {
		return JSON.stringify(output, null, 2);
	} catch {
		return String(output);
	}
}

export function ToolCallCard({ part }: ArtifactPartProps) {
	const p = part as ToolCallPart;
	const tool = p.type.replace(/^tool-/, "");
	const arg = headlineArg(tool, p.input);
	const out = outputText(p.output);
	const failed = p.state === "output-error" || typeof p.errorText === "string";
	return (
		<details
			data-testid="tool-call-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2.5 text-[15px] text-ink-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-ink [&::-webkit-details-marker]:hidden">
				<span className={failed ? "text-ans-wrong" : "text-ink"}>
					{DONE_LABEL[tool] ?? tool}
				</span>
				{arg && <span className="truncate" title={arg}>{arg}</span>}
				<PixelIcon name="chevron" className="shrink-0 transition-transform duration-(--lh-dur) ease-(--lh-ease-out) group-open:rotate-90" />
			</summary>
			<div className={cn(CARD, "mt-2 flex flex-col gap-3 py-3")}>
				{p.input != null && (
					<div>
						<div className="mb-1 text-[15px] text-ink-2">
							Input
						</div>
						<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-ink">
							{JSON.stringify(p.input, null, 2)}
						</pre>
					</div>
				)}
				{typeof p.errorText === "string" ? (
					<div>
						<div className="mb-1 text-[15px] text-ink-2">
							Error
						</div>
						<pre className="whitespace-pre-wrap break-all font-mono text-[13px] text-ans-wrong">
							{p.errorText}
						</pre>
					</div>
				) : out != null ? (
					<div>
						<div className="mb-1 text-[15px] text-ink-2">
							Output
						</div>
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-ink">
							{out}
						</pre>
					</div>
				) : (
					p.state !== "output-available" && (
						<div className="text-[15px] italic text-ink-2">running…</div>
					)
				)}
			</div>
		</details>
	);
}
