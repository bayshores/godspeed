import { useState } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { useFold } from "@/frontend/components/use-fold";

/**
 * The graph-context card: the session's map pick —
 * message[0] of a session started with propositions picked from the
 * graph. Scaffolding, not a turn: one quiet line, collapsed by default;
 * expand reveals the picked propositions (name — statement) and the
 * reasoning chains among them (premises → conclusion lines). The model
 * reads the same content through the marker's own text (toLlmMessages);
 * this card is the learner's face of it.
 */

/** The graph-context marker's details (native-messages.ts). */
export interface GraphContextData {
	propositions: { id: string; name: string; statement: string }[];
	chains: string[];
}

export function GraphContextCard({ data }: { data: GraphContextData }) {
	const [open, setOpen] = useState(false);
	const fold = useFold(open); // eases open/shut
	const { propositions = [], chains = [] } = data ?? {};
	const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	return (
		<div data-testid="graph-context-card" className="my-1">
			<button
				type="button"
				data-testid="graph-context-toggle"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2.5 py-1 text-left text-[15px] text-ink-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-ink"
			>
				<PixelIcon name="chevron" className={cn("transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open && "rotate-90")} />
				<span className="text-ink">Graph context</span>
				<span className="min-w-0 flex-1 truncate text-sm">
					{noun(propositions.length, "fact", "facts")}
					{chains.length > 0 ? `, ${noun(chains.length, "chain", "chains")}` : ""}
				</span>
			</button>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
				<div>
				<div data-testid="graph-context-body" className="mt-1 space-y-1 rounded border border-border bg-background px-4 py-3 text-[15px]">
					{propositions.map((p) => (
						<div key={p.id} data-testid={`graph-context-prop-${p.id}`} className="leading-relaxed">
							<span className="text-ink">{p.name}</span>
							<span className="text-ink-2">: {p.statement}</span>
						</div>
					))}
					{chains.length > 0 && (
						<div className="pt-1">
							{chains.map((c, i) => (
								<div key={i} className="font-mono text-[13px] text-ink-2">
									{c}
								</div>
							))}
						</div>
					)}
				</div>
				</div>
				</div>
			)}
		</div>
	);
}

/** The space card's details (native-messages.ts SpaceCardDetails). */
export interface SpaceContextData {
	spaceId: string;
	name: string;
	description: string;
	files: { name: string; kind: "study" | "info"; path: string | null }[];
}

/**
 * The space card: message[0] of
 * a lesson in a space — the space name, the learner's description, and
 * the space files the teacher can open. Same scaffolding look as the
 * graph-context card: muted, collapsed by default.
 */
export function SpaceContextCard({ data }: { data: SpaceContextData }) {
	const [open, setOpen] = useState(false);
	const fold = useFold(open);
	const { name = "", description = "", files = [] } = data ?? {};
	return (
		<div data-testid="space-context-card" className="my-1">
			<button
				type="button"
				data-testid="space-context-toggle"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2.5 py-1 text-left text-[15px] text-ink-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-ink"
			>
				<PixelIcon name="chevron" className={cn("transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open && "rotate-90")} />
				<span className="text-ink">Space context</span>
				<span className="min-w-0 flex-1 truncate text-sm">
					{name}
					{files.length > 0 ? `, ${files.length} ${files.length === 1 ? "file" : "files"} when this lesson started` : ""}
				</span>
			</button>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
				<div>
				<div data-testid="space-context-body" className="mt-1 space-y-2 rounded border border-border bg-background px-4 py-3 text-[15px]">
					{description.trim() && <p className="font-prose whitespace-pre-wrap text-base leading-relaxed text-ink-2">{description}</p>}
					{files.map((f, i) => (
						<div key={i} className="leading-relaxed">
							<span className="text-ink-2">{f.kind === "study" ? "Study" : "Info"}</span>
							<span className="ml-2 text-ink">{f.name}</span>
						</div>
					))}
				</div>
				</div>
				</div>
			)}
		</div>
	);
}
