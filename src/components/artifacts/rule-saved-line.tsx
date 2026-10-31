"use client";

/**
 * The save_rule call in a lesson: one quiet line, "Saved a rule for every
 * lesson: …", with Undo and Edit. A refused call (the list was full)
 * renders nothing: the teacher tells the learner itself.
 */

import { BookmarkCheckIcon } from "lucide-react";
import { parseSaveRuleResult, type ArtifactPartProps, type SaveRuleResult } from "@/core";
import { RuleEditBox, useSavedRule } from "@/components/saved-rule";

export function RuleSavedLine({ part }: ArtifactPartProps) {
	const saved = part.state === "output-available" ? parseSaveRuleResult(part.output) : null;
	return saved ? <Line saved={saved} /> : null;
}

function Line({ saved }: { saved: SaveRuleResult }) {
	const api = useSavedRule(saved.where, saved.rule);
	const { mode } = api;
	return (
		<div data-testid="rule-saved" className="my-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 font-ui text-[13px] text-ink-2">
			<BookmarkCheckIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
			{mode.kind === "removed" ? (
				<span>Removed the rule: {api.rule}</span>
			) : mode.kind === "editing" ? (
				<>
					<span className="shrink-0">Rule for {saved.for}:</span>
					<RuleEditBox api={api} draft={mode.draft} />
				</>
			) : (
				<>
					<span className="min-w-0">
						Saved a rule for {saved.for}: <span className="text-ink">{api.rule}</span>
					</span>
					{mode.kind === "error" ? (
						<span role="alert" className="text-ans-wrong">
							{mode.message}
						</span>
					) : (
						<>
							<button type="button" data-testid="rule-saved-undo" disabled={api.busy} onClick={api.undo} className="lh-press font-bold hover:text-ink disabled:opacity-50">
								Undo
							</button>
							<button type="button" data-testid="rule-saved-edit" disabled={api.busy} onClick={api.edit} className="lh-press font-bold hover:text-ink disabled:opacity-50">
								Edit
							</button>
						</>
					)}
				</>
			)}
		</div>
	);
}
