/**
 * The learner's rules: each rule as a chip with a remove button, then the
 * "Add a rule" field. Used by Settings → Teaching (per area) and Edit space
 * (per space). A rule the agent saved says "Saved by" and the teacher's
 * name, with the date on hover.
 */

import { useState } from "react";
import { RULE_MAX_CHARS, RULES_MAX, oneLine } from "@/shared/core";
import { chip } from "@/frontend/components/ui/chip";
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
				<ul className="flex flex-wrap items-center gap-1.5">
					{rules.map((rule) => (
						<RuleChip key={rule} rule={rule} savedBy={saved[rule] ? { name: teacherName, at: saved[rule] } : undefined} onRemove={() => onChange(rules.filter((r) => r !== rule))} />
					))}
				</ul>
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

/** One rule as a chip in a list: its words, who saved it when the teacher did (the day on hover), and its remove key. */
export function RuleChip({ rule, savedBy, onRemove, testid }: { rule: string; savedBy?: { name: string; at: string }; onRemove: () => void; testid?: string }) {
	return (
		<li data-testid={testid} className={chip("well", "item", { remove: true })}>
			<span className="min-w-0 break-words">{rule}</span>
			{savedBy && (
				<span title={savedDay(savedBy.at)} className="shrink-0 whitespace-nowrap text-ink-2">
					Saved by {savedBy.name}
				</span>
			)}
			<button type="button" aria-label={`Remove rule: ${rule}`} className="lh-press shrink-0 p-0.5 text-ink-2 hover:text-ink" onClick={onRemove}>
				<PixelIcon name="close" />
			</button>
		</li>
	);
}

/** "Oct 30". */
export function savedDay(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
