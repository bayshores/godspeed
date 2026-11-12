"use client";

/**
 * The save_rule call in a lesson: one quiet line, "Saved a rule for every
 * lesson: …", with Undo and Edit. A refused call (the list was full)
 * renders nothing: the teacher tells the learner itself.
 */

import { SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { parseSaveRuleResult, type ArtifactPartProps, type SaveRuleResult } from "@/shared/core";
import { RuleEditBox, useSavedRule } from "@/frontend/components/saved-rule";

export function RuleSavedLine({ part }: ArtifactPartProps) {
	const saved = part.state === "output-available" ? parseSaveRuleResult(part.output) : null;
	return saved ? <Line saved={saved} /> : null;
}

function Line({ saved }: { saved: SaveRuleResult }) {
	const api = useSavedRule(saved.where, saved.rule);
	const { mode } = api;
	return (
		<div data-testid="rule-saved" className="my-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[15px] text-ink">
			{mode.kind === "removed" ? (
				<span>Removed the rule: {api.rule}</span>
			) : mode.kind === "editing" ? (
				<>
					<span className="shrink-0">Rule for {saved.for}:</span>
					<RuleEditBox api={api} draft={mode.draft} />
				</>
			) : (
				<>
					<span className="min-w-0 flex-1">
						Saved a rule for {saved.for}: {api.rule}
					</span>
					{mode.kind === "error" ? (
						<span role="alert" className="text-ans-wrong">
							{mode.message}
						</span>
					) : (
						<>
							<button type="button" data-testid="rule-saved-undo" disabled={api.busy} onClick={api.undo} className={SMALL_BTN}>
								Undo
							</button>
							<button type="button" data-testid="rule-saved-edit" disabled={api.busy} onClick={api.edit} className={SMALL_BTN}>
								Edit
							</button>
						</>
					)}
				</>
			)}
		</div>
	);
}
