/**
 * The learner's rules: each rule as a chip with a remove button, then the
 * "Add a rule" field. Used by Settings → Teaching (per area) and Edit space
 * (per space). A rule the agent saved says "Saved by" and the teacher's
 * name, with the date on hover.
 */

import { useState } from "react";
import { RULE_MAX_CHARS, RULES_MAX, oneLine } from "@/shared/core";
import { FIELD } from "@/frontend/components/ui/field";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

export function RuleChips({
	rules,
	onChange,
	testid,
	saved,
	teacherName,
}: {
	rules: string[];
	onChange: (next: string[]) => void;
	testid?: string;
	/** When the agent saved each of these rules, by rule text. */
	saved: Record<string, string>;
	teacherName: string;
}) {
	const [draft, setDraft] = useState("");
	// Enter and clicking away both add the rule, so no key is needed.
	const commit = () => {
		const rule = oneLine(draft, RULE_MAX_CHARS);
		if (rule && !rules.includes(rule)) onChange([...rules, rule]);
		setDraft("");
	};
	return (
		<div data-testid={testid} className="flex flex-col gap-1.5">
			{rules.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{rules.map((rule) => (
						<span key={rule} className="flex max-w-full items-center gap-2.5 rounded border border-border bg-background py-1.5 pr-2 pl-3 text-base text-ink">
							<span className="min-w-0 break-words">{rule}</span>
							{saved[rule] && (
								<span title={savedDay(saved[rule])} className="shrink-0 text-sm whitespace-nowrap text-ink-2">
									Saved by {teacherName}
								</span>
							)}
							<button type="button" aria-label={`Remove rule: ${rule}`} className="lh-press shrink-0 p-0.5 text-ink-2 hover:text-ink" onClick={() => onChange(rules.filter((r) => r !== rule))}>
								<PixelIcon name="close" className="h-[10.5px]" />
							</button>
						</span>
					))}
				</div>
			)}
			{rules.length < RULES_MAX && (
				<input
					type="text"
					value={draft}
					maxLength={RULE_MAX_CHARS}
					aria-label="Add a rule"
					placeholder="Add a rule"
					data-testid={testid ? `${testid}-input` : undefined}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
						// The dialog behind closes on Escape; with text typed this one only clears it.
						if (e.key === "Escape" && draft !== "") {
							e.stopPropagation();
							setDraft("");
						}
					}}
					className={FIELD}
				/>
			)}
		</div>
	);
}

/** "Oct 30". */
export function savedDay(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
