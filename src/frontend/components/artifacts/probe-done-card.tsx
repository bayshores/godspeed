import { CARD } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import { parseProbeDoneInput, type ProbeDoneResult } from "@/shared/core";

/**
 * The probe conclusion card: renders the
 * prober's probe_done call. The INPUT is the learner assessment — strand by
 * strand, where his edge sits — and it belongs to the learner as much as to
 * the transcript: it streams live while the prober writes it and stays as
 * the handoff artifact. The OUTPUT is the seam's ack (ok) or the refusal
 * the prober retried on (rendered quiet and small — it is model-facing
 * bookkeeping, kept only for transcript honesty).
 *
 * The input preview is only trustworthy while the call is pending — an
 * input-available input cleared schema validation at the boundary, and a
 * mid-stream partial is guarded below. An output-error part's input was
 * REJECTED by validation and can be any shape (e.g. a stringified
 * `assessment`); never render it.
 *
 * Deliberately plain: this card guarantees the data is never invisible.
 */
export function ProbeDoneCard({ part }: { part: { input?: unknown; output?: unknown; state?: unknown } }) {
	const output = part.output as ProbeDoneResult | undefined;
	const state = typeof part.state === "string" ? part.state : "";

	// Parse, don't cast (the seam rule, src/shared/core/tool-parts.ts): the model
	// authored this input — it is consumer-trustworthy only if the SAME
	// schema the tool declared says so. An errored call's stringified
	// assessment, a mid-stream partial: anything that doesn't parse falls to the
	// fallback branch. Output stays a cast: OUR execute authored it.
	const input = parseProbeDoneInput(part.input);

	// The assessment is the CALL's input: the result's details are
	// {ok:true} only, and the refusal branch below reads output.error.
	const assessment = input?.assessment;
	const strands = assessment && Array.isArray(assessment.strands) ? assessment.strands : null;

	return (
		<div data-testid="probe-done-card" className={cn(CARD, "my-3 flex flex-col gap-2.5")}>
			<div className="text-lg text-ink">Warm-up done: what you already know</div>
			{output && !output.ok ? (
				<p className="font-prose text-[16px] text-ink-2">The teacher tried again: {output.error}</p>
			) : state === "output-error" ? (
				<p className="font-prose text-[16px] text-ink-2">
					The assessment was malformed. The teacher tried again with a corrected one.
				</p>
			) : strands ? (
				<div className="flex flex-col gap-2">
					{strands.map((s, i) => (
						<div key={i} className="rounded-sm bg-panel px-3 py-2">
							<div className="text-[15px] font-medium text-ink">{s.strand}</div>
							<div className="mt-0.5 font-prose text-[16px] text-ink-2">{s.assessment}</div>
						</div>
					))}
					{assessment?.summary && (
						<p className="px-1 font-prose text-[16px] text-ink-2">{assessment.summary}</p>
					)}
				</div>
			) : (
				<p className="font-prose text-[16px] text-ink-2">Writing the assessment…</p>
			)}
		</div>
	);
}