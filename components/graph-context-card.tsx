"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The graph-context card (owner, 2026-10-04): the session's map pick —
 * message[0] of a session started with propositions picked from the
 * graph. Scaffolding, not a turn: minimal, muted, collapsed by default;
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
	const { propositions = [], chains = [] } = data ?? {};
	const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	return (
		<div data-testid="graph-context-card" className="my-1">
			<button
				type="button"
				data-testid="graph-context-toggle"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="font-medium">Graph context</span>
				<span className="min-w-0 flex-1 truncate">
					{noun(propositions.length, "proposition", "propositions")}
					{chains.length > 0 ? ` · ${noun(chains.length, "chain", "chains")}` : ""}
				</span>
			</button>
			{open && (
				<div data-testid="graph-context-body" className="mt-1 space-y-1 rounded-lg border border-dashed border-border/70 px-4 py-3 text-xs">
					{propositions.map((p) => (
						<div key={p.id} data-testid={`graph-context-prop-${p.id}`} className="leading-relaxed">
							<span className="font-medium text-foreground/80">{p.name}</span>
							<span className="text-muted-foreground"> — {p.statement}</span>
						</div>
					))}
					{chains.length > 0 && (
						<div className="pt-1">
							{chains.map((c, i) => (
								<div key={i} className="font-mono text-[11px] text-muted-foreground">
									{c}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** The class card's details (native-messages.ts ClassCardDetails). */
export interface ClassContextData {
	classId: string;
	name: string;
	description: string;
	files: { name: string; kind: "study" | "info"; path: string | null }[];
}

/**
 * The class card (classes wave, owner-approved 2026-10-26): message[0] of
 * a lesson in a class — the class name, the learner's description, and
 * the class files the teacher can open. Same scaffolding look as the
 * graph-context card: muted, collapsed by default.
 */
export function ClassContextCard({ data }: { data: ClassContextData }) {
	const [open, setOpen] = useState(false);
	const { name = "", description = "", files = [] } = data ?? {};
	return (
		<div data-testid="class-context-card" className="my-1">
			<button
				type="button"
				data-testid="class-context-toggle"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<span className="font-medium">Class context</span>
				<span className="min-w-0 flex-1 truncate">
					{name}
					{files.length > 0 ? ` · ${files.length} ${files.length === 1 ? "file" : "files"}` : ""}
				</span>
			</button>
			{open && (
				<div data-testid="class-context-body" className="mt-1 space-y-2 rounded-lg border border-dashed border-border/70 px-4 py-3 text-xs">
					{description.trim() && <p className="font-prose whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{description}</p>}
					{files.map((f, i) => (
						<div key={i} className="leading-relaxed">
							<span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{f.kind === "study" ? "study" : "info"}</span>
							<span className="ml-2 text-foreground/80">{f.name}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
