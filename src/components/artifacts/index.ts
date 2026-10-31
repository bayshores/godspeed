import type { ComponentType } from "react";
import type { ArtifactPartProps } from "@/core";
import { DemoCard } from "@/components/artifacts/demo-card";
import { JobCard, PdfJobCard } from "@/components/artifacts/job-card";
import { VisualCard } from "@/components/artifacts/visual-card";
import { ProbeDoneCard } from "@/components/artifacts/probe-done-card";
import { RuleSavedLine } from "@/components/artifacts/rule-saved-line";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import { ProblemCard, ConcludeCard } from "@/components/practice-cards";

/**
 * Artifact renderer registry — the extension point for tool-part UI.
 *
 * chat.tsx renders any tool part it doesn't specially handle (i.e. not
 * quiz/ask) by looking the tool name up here. Add new renderers here, not
 * in chat.tsx.
 *
 * Typical shape: while the part is input-available render an activity card
 * (the chat view's jobs feed reads GET /api/jobs?chatId=…; the lesson's jobs
 * fetch in lesson/use-lesson-server.ts syncs the record when a job settles);
 * when output-available render the
 * artifact itself from part.output.
 */
export const artifactRenderers: Record<string, ComponentType<ArtifactPartProps>> = {
	research: JobCard,
	pdf: PdfJobCard,
	// plan_* parts render nothing inline by design: the phase seam is a
	// message-level boundary, drawn by PhaseDivider in lesson/message-row.tsx.
	demo: DemoCard,
	visual: VisualCard,
	// The probe conclusion: the assessment belongs to the learner as much as
	// to the transcript.
	probe_done: ProbeDoneCard,
	// The learner-filesystem set: one quiet expandable
	// tool-call card each — collapsed one-liner (tool name + headline
	// argument), full input/output on expand.
	read: ToolCallCard,
	ls: ToolCallCard,
	find: ToolCallCard,
	grep: ToolCallCard,
	// The practice pair: the pose renders the statement ONLY
	// (the commitment lives in the call's arguments and never renders);
	// the conclusion carries the outcome + verdict + the reveal.
	problem: ProblemCard,
	conclude: ConcludeCard,
	// The prober's graph tools: same quiet expandable card, the tool's own
	// pre-formatted output verbatim on expand.
	list_sessions: ToolCallCard,
	list_propositions: ToolCallCard,
	// A rule the teacher saved: one line with Undo and Edit.
	save_rule: RuleSavedLine,
};
