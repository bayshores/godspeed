/**
 * The Agent section (settings-app wave): the tool toggles, the context
 * (compaction) threshold, and the prompt override switches. There are no
 * model pickers: the outside agent (MCP) is the only model and picks its
 * own model and effort in its own harness (owner, 2026-10-27).
 *
 * Tools — the owner's final list (2026-09-19): research, demo, visual, pdf.
 * Absent key = enabled in the schema; the UI writes explicit booleans for
 * all four (simpler to reason about, sanitize-equivalent).
 *
 * Prompts: GET /api/settings/prompts segments — THREE SECTIONS in the
 * owner's ruled order (2026-09-26 overhaul): Teacher first, Prober, then
 * Shared LAST. The server returns per-agent lists that each INCLUDE the
 * shared segments; sectionedSegments deduplicates them (shared chunks
 * once, in prompt-assembly order). The row rulings: only the TOGGLE
 * grays when there's no override file (the file name is always
 * full-contrast); NO description line when there's no override (the empty
 * state is clean — toggle + name); the indicator ("Your version is
 * saved") appears ONLY when an override exists. The switch requires an
 * override FILE (route-enforced), so a file-less toggle is disabled.
 * The segments view re-reads on the 'lh:settings-saved' signal for the
 * agent section — the view's enabled flags derive from the record's
 * switches, and the 2026-09-26 state-echo bug was exactly this reader
 * missing (the toggle painted its old state until a remount re-fetched).
 */

import { useCallback, useEffect, useState } from "react";
import { useSettingsSaved } from "@/components/settings-signal";
import type React from "react";
import {
	COMPACTION_THRESHOLD_FLOOR,
	resolveSettings,
	type AgentSettings,
	type CompactionSettings,
	type GraphSettings,
} from "@/core";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, Toggle, CommitInput } from "./controls.tsx";

/** The owner's final toggleable-tool list (confirm with the user before
 *  changing — the Teacher stream settled this 2026-09-19). */
export const TOGGLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

/** SegmentInfo as GET /api/settings/prompts returns it. */
interface SegmentInfo {
	path: string;
	sourceText: string;
	overrideText: string | null;
	enabled: boolean;
	shared: boolean;
}

/** Compose: one tool toggled, the rest of the section carried verbatim.
 *  Pure — exported for tests. */
export function composeTool(agent: AgentSettings | undefined, id: string, on: boolean): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, [id]: on } };
}

/** The quizzing mechanics (owner 2026-09-27): a segmented control, not a
 *  toggle — exactly one mechanic is ever active. `explain: true` arms
 *  free-recall (explain in, quiz out); anything else is multiple choice.
 *  `quiz` itself is never written (mechanics-managed — see quizMechanics
 *  in agent/tools.ts). Pure — exported for tests. */
export function composeQuizMechanics(agent: AgentSettings | undefined, mechanics: "choice" | "free"): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, explain: mechanics === "free" } };
}

/** Compose the prober graph-tools toggle (wave 7): its own key in the
 *  agent section — never in the tool-toggles map (owner ruling). Absent =
 *  ON (the toggle discipline); the write is explicit either way, so an
 *  explicit-off record stays visible as stored. Pure — exported for tests. */
export function composeGraphTools(agent: AgentSettings | undefined, on: boolean): AgentSettings {
	return { ...agent, graphTools: { enabled: on } };
}

/** The indicator under a row whose override IS the version in use (owner
 *  ruling, refined 2026-09-26: the small text states WHICH VERSION IS
 *  IN USE — "Your version is in use" when the switch is on, and NOTHING
 *  when the default composes, even if a saved override sits on disk
 *  unused. The switch's meaning becomes legible: it visibly controls
 *  this line). Exported for the pin. */
export const PROMPT_IN_USE_HINT = "Your version is in use";

/** One section of the prompt view — the owner's ruled order: Teacher,
 *  Prober, then Shared last. */
export interface PromptSection {
	id: "teacher" | "prober" | "shared";
	label: string;
	/** The one header that earns a hint: "Shared" alone is not
	 *  self-evident. Teacher/Prober are. */
	hint?: string;
	segments: SegmentInfo[];
}

/** Split the server's per-agent segment lists into the owner's three
 *  sections. The server contract returns the shared segments in BOTH
 *  lists (same paths, same content) — the shared chunks are listed ONCE
 *  here (taken from the teacher list; identical by construction), in
 *  assembly order: the base file, then the shared fragments sorted. The
 *  agents' own chunks keep their lists' order — which IS the prompt
 *  assembly order (numeric-prefix filename sort). Pure — exported for
 *  tests. */
export function sectionedSegments(view: { prober: SegmentInfo[]; teacher: SegmentInfo[] }): PromptSection[] {
	const own = (who: "prober" | "teacher") => view[who].filter((s) => !s.shared);
	return [
		{ id: "teacher", label: "Teacher", segments: own("teacher") },
		{ id: "prober", label: "Prober", segments: own("prober") },
		{
			id: "shared",
			label: "Shared",
			hint: "Used by both agents",
			segments: view.teacher.filter((s) => s.shared),
		},
	];
}

/** Compose: one prompt switch. on = explicit true; off = key REMOVED
 *  (absent = off is the schema's resting state; explicit false is the
 *  same thing but noisier). Pure — tests. */
export function composePromptSwitch(agent: AgentSettings | undefined, path: string, on: boolean): AgentSettings {
	const prompts = { ...agent?.prompts };
	if (on) prompts[path] = true;
	else delete prompts[path];
	return { ...agent, prompts };
}

export function AgentSection({
	agent,
	graph,
	compaction,
	onSectionChange,
	onCompactionChange,
}: {
	agent: AgentSettings | undefined;
	/** The `graph` section — READ ONLY here: the graphTools row composes its
	 *  master switch (graph.enabled off dims + disables the row; the
	 *  effective gate is server-side, per-turn fresh). */
	graph: GraphSettings | undefined;
	/** The `compaction` section — its own PUT (the threshold is engine
	 *  behavior, not an agent-section key; owner round 14, Agent tab). */
	compaction: CompactionSettings | undefined;
	/** Writes the composed WHOLE agent section (replace-PUT discipline). */
	onSectionChange: (next: AgentSettings) => void;
	/** Writes the whole compaction section (replace-PUT discipline). */
	onCompactionChange: (next: CompactionSettings) => void;
}) {
	const [prompts, setPrompts] = useState<{ prober: SegmentInfo[]; teacher: SegmentInfo[] } | null>(null);
	const [openSegment, setOpenSegment] = useState<string | null>(null);
	const [segmentDraft, setSegmentDraft] = useState<Record<string, string>>({});
	const [segmentStatus, setSegmentStatus] = useState<string | null>(null);

	/** Re-read the prompt-segment view — the signal seam for the
	 *  2026-09-26 state-echo fix: the view's `enabled` flags DERIVE from
	 *  the settings record's agent switches (the toggle's truth lives
	 *  here, not in the `agent` prop), so an agent-section write must
	 *  re-read it or the toggle keeps painting its pre-write state until
	 *  a remount. Keeps the last-good view on a failed re-read (the
	 *  initial mount fetch below owns the loading/null state). */
	const readPrompts = useCallback(() => {
		fetch("/api/settings/prompts")
			.then((r) => r.json())
			.then((body: { prober: SegmentInfo[]; teacher: SegmentInfo[] }) => setPrompts(body))
			.catch(() => {});
	}, []);

	useSettingsSaved((section) => {
		// THE state-echo root cause: the prompt switches write through the
		// agent section, but this view (the toggles' truth) never re-read —
		// the settings-saved law (every reader re-reads) was missing this
		// one reader.
		if (section === "agent") readPrompts();
	});

	useEffect(() => {
		fetch("/api/settings/prompts")
			.then((r) => r.json())
			.then((body: { prober: SegmentInfo[]; teacher: SegmentInfo[] }) => setPrompts(body))
			.catch(() => setPrompts(null));
	}, []);

	async function saveSegment(path: string, text: string) {
		setSegmentStatus(null);
		const res = await fetch(`/api/settings/prompts/${path}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
		});
		if (!res.ok) {
			setSegmentStatus(`Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
			return;
		}
		readPrompts();
		setSegmentStatus("Saved");
		// Auto-on (owner ruling, refined 2026-09-26): writing an override and
		// putting it to work are ONE action — a save with the switch off was
		// the "did something, changed nothing" trap (the composed prompt
		// stayed the default). The file exists now, so the ON switch the
		// agent-section validation requires is legal; the order (file, then
		// switch) is the safe one. Saving an edit while already on rides
		// through — the switch write is idempotent at the record level.
		if (agent?.prompts?.[path] !== true) {
			onSectionChange(composePromptSwitch(agent, path, true));
		}
	}

	async function deleteSegment(path: string) {
		setSegmentStatus(null);
		const res = await fetch(`/api/settings/prompts/${path}`, { method: "DELETE" });
		if (!res.ok) {
			setSegmentStatus(`Delete failed: ${res.status}`);
			return;
		}
		// Auto-off — the mirror of save's auto-on: deleting the file while
		// the switch is on would orphan an ON record switch (the agent-section
		// validation 400s every later write while the UI's toggle can no
		// longer reach the OFF escape hatch — the trap found in live verify
		// 2026-09-26). Composing the OFF here keeps the record clean.
		if (agent?.prompts?.[path] === true) {
			onSectionChange(composePromptSwitch(agent, path, false));
		}
		readPrompts();
		setSegmentStatus("Deleted");
	}

	const segmentRow = (info: SegmentInfo) => {
		const fileExists = info.overrideText !== null;
		const open = openSegment === info.path;
		// The Save affordance (owner ruling, refined 2026-09-26): clickable
		// only when there's something to save — the draft differs from
		// what's on disk. An unchanged editor shows a grayed, inert Save
		// (the always-active button was the "doesn't feel like it does
		// anything" half of the report).
		const draft = segmentDraft[info.path] ?? info.overrideText ?? "";
		const dirty = draft !== (info.overrideText ?? "");
		return (
			<div key={info.path} data-testid={`prompt-segment-${info.path}`}>
				<SettingsRow
					label={info.path}
					// Overhaul rulings (2026-09-26, refined): the small text
					// states WHICH VERSION IS IN USE — nothing when the
					// default composes (even with a saved override sitting
					// on disk unused), "Your version is in use" when the
					// switch is on. The switch's meaning becomes legible
					// through this line.
					hint={info.enabled ? PROMPT_IN_USE_HINT : undefined}
					testid={`prompt-row-${info.path}`}
				>
					{/* Graying ruling: ONLY the toggle dims without an
					    override file — the file name above stays
					    full-contrast (the whole-row dim is dead). */}
					<span className={fileExists ? undefined : "opacity-40"}>
						<Toggle
							checked={info.enabled}
							disabled={!fileExists}
							label={`prompt ${info.path}`}
							onChange={(on) => onSectionChange(composePromptSwitch(agent, info.path, on))}
						/>
					</span>
				</SettingsRow>
				<button
					type="button"
					onClick={() => {
						setOpenSegment(open ? null : info.path);
						setSegmentStatus(null);
					}}
					className="lh-press text-xs text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
				>
					{open ? "Hide text" : "Show text"}
				</button>
				{open && (
					<div className="mt-1 flex flex-col gap-2">
						<div>
							<p className="mb-1 text-xs font-semibold text-muted-foreground/70">Source</p>
							<textarea
								readOnly
								value={info.sourceText}
								aria-label="The original instructions"
								className="h-24 w-full resize-y border border-border bg-muted p-2 font-ui text-xs text-muted-foreground"
							/>
						</div>
						<div>
							<p className="mb-1 text-xs font-semibold text-muted-foreground/70">Override</p>
							<textarea
								value={segmentDraft[info.path] ?? info.overrideText ?? ""}
								onChange={(e) => setSegmentDraft({ ...segmentDraft, [info.path]: e.target.value })}
								aria-label="Your version of the instructions"
								placeholder="Add your own instructions…"
								className="h-24 w-full resize-y border border-border bg-background p-2 font-ui text-xs text-foreground outline-none"
							/>
						</div>
						<div className="flex items-center gap-3">
							<button
								type="button"
								disabled={!dirty}
								onClick={() => void saveSegment(info.path, segmentDraft[info.path] ?? "")}
								className={
									dirty
										? "lh-press text-xs text-foreground underline-offset-2 hover:underline"
										: "lh-press cursor-not-allowed text-xs text-muted-foreground/40 underline-offset-2"
								}
							>
								Save
							</button>
							{fileExists && (
								<button
									type="button"
									onClick={() => void deleteSegment(info.path)}
									className="lh-press text-xs text-muted-foreground/70 underline-offset-2 hover:text-red-500 hover:underline"
								>
									Delete
								</button>
							)}
							{/* The quiet inline confirmation — next to the
							    action, not the old path-echoing line at the
							    section's bottom (production-copy: no file
							    paths in user-facing status). One editor is
							    open at a time (openSegment), so one shared
							    status reads unambiguously. */}
							{segmentStatus && (
								<p className="text-xs text-muted-foreground/70" data-testid="segment-status">
									{segmentStatus}
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		);
	};



	// Resolved through the SAME core resolver the server's effective
	// settings use (the GraphSection precedent): the hint and placeholder
	// report exactly the number the trigger waits for.
	const resolvedCompaction = resolveSettings(
		compaction === undefined ? null : { version: 1, compaction },
	).compaction;

	return (
		<>
			<SettingsGroup label="Tools" testid="group-tools">
				{/* The prober's graph tools (wave 7, owner ruling 2026-09-23):
				    FIRST row of the group — its subject is the map, its
				    mechanism is agent capability, so it lives in Tools but
				    NOT in the tool-toggles list. Its own agent-section key
				    (agent.graphTools), with a smaller line under it explaining what it is — this
				    connects prior sessions' knowledge into new ones. */}
				{(() => {
					const graphOn = graph?.enabled ?? true;
					return (
						<SettingsRow
							label="Graph tools"
							hint={graphOn ? "Lets the tutor consult your knowledge map between sessions" : "Graph is disabled"}
							testid="graph-tools-row"
							dimmed={!graphOn}
						>
							<Toggle
								checked={agent?.graphTools?.enabled ?? true}
								disabled={!graphOn}
								label="graph tools"
								onChange={(on) => onSectionChange(composeGraphTools(agent, on))}
							/>
						</SettingsRow>
					);
				})()}
				{/* The quizzing mechanic (owner 2026-09-27): segmented — exactly one
				    of Multiple choice / Free recall is active; the choice swaps which
				    quizzing tool BOTH agents carry (prober checks + teach checks).
				    Persisted as agent.tools.explain; absent = Multiple choice. */}
				{(() => {
					const free = agent?.tools?.explain === true;
					return (
						<SettingsRow
							label="Quizzing"
							hint="How both tutors check your understanding"
							testid="quiz-mechanics-row"
						>
							<div
								role="radiogroup"
								aria-label="Quizzing mechanics"
								className="flex border border-border/60 bg-muted/30 p-0.5"
								>
								{(["choice", "free"] as const).map((m) => {
									const active = m === "free" ? free : !free;
									return (
										<button
											key={m}
											type="button"
											role="radio"
											aria-checked={active}
											data-testid={`quiz-mechanics-${m}`}
											onClick={() => onSectionChange(composeQuizMechanics(agent, m))}
											className={cn(
												"lh-press h-8 px-3 text-sm font-medium",
												active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
											)}
										>
											{m === "choice" ? "Multiple choice" : "Free recall"}
										</button>
									);
								})}
							</div>
						</SettingsRow>
					);
				})()}
				{TOGGLE_TOOLS.map((id) => (
					<SettingsRow
						key={id}
						label={`Tool · ${id}`}
						testid={`tool-row-${id}`}
					>
						<Toggle
							checked={agent?.tools?.[id] ?? true}
							label={`tool ${id}`}
							onChange={(on) => onSectionChange(composeTool(agent, id, on))}
						/>
					</SettingsRow>
				))}
			</SettingsGroup>

			<SettingsGroup label="Context" testid="group-context">
				<SettingsRow
					label="Compaction threshold"
					hint={`${resolvedCompaction.thresholdTokens} tok`}
					testid="compaction-row-threshold"
				>
					<CommitInput
						type="number"
						value={String(compaction?.thresholdTokens ?? "")}
						placeholder={String(resolvedCompaction.thresholdTokens)}
						ariaLabel="compaction threshold"
						testid="input-compaction-threshold"
						onCommit={(v) => {
							// Empty = factory default (the budget row's discipline):
							// absence is the unset for numbers.
							if (v === "") {
								onCompactionChange({ ...compaction, thresholdTokens: undefined });
								return;
							}
							const n = Number(v);
							if (!Number.isFinite(n) || n <= 0) return; // bad input: no write
							// Mirror the server floor (anti-churn: each compaction
							// keeps a ~20k-token tail); no ceiling — the effective
							// trigger is min(threshold, contextWindow − 16k) anyway.
							onCompactionChange({
								...compaction,
								thresholdTokens: Math.max(COMPACTION_THRESHOLD_FLOOR, Math.round(n)),
							});
						}}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="System prompts" testid="group-prompts">
				{prompts === null ? (
					<p className="text-xs text-muted-foreground/70">Loading prompt segments…</p>
				) : (
					<div className="flex flex-col gap-4">
						{/* The owner's ruled order (2026-09-26): Teacher first,
						    then Prober, then Shared LAST — shared chunks once
						    (deduplicated), each section in prompt-assembly
						    order. */}
						{sectionedSegments(prompts).map((section) => (
							<div key={section.id} data-testid={`prompt-section-${section.id}`}>
								<p className="mb-1 text-xs font-semibold text-muted-foreground/70">
									{section.label}
								</p>
								{section.hint && (
									<p className="mb-1 text-xs text-muted-foreground/60">{section.hint}</p>
								)}
								<div className="flex flex-col gap-2">
									{section.segments.map((info) => segmentRow(info))}
								</div>
							</div>
						))}
					</div>
				)}
			</SettingsGroup>
		</>
	);
}
