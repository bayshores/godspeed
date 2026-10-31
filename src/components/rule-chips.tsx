/**
 * The learner's rules as chips: each rule with a remove ✕, then "Add a
 * rule", which turns into a one-line input. Used by Settings → Teaching
 * (per area) and Edit class (per class). A rule the agent saved says
 * "Saved by Halley", with the date on hover.
 */

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { RULE_MAX_CHARS, RULES_MAX, oneLine } from "@/core";

export function RuleChips({
	rules,
	onChange,
	addLabel = "Add a rule",
	testid,
	saved,
	teacherName,
}: {
	rules: string[];
	onChange: (next: string[]) => void;
	addLabel?: string;
	testid?: string;
	/** When the agent saved each of these rules, by rule text. */
	saved: Record<string, string>;
	teacherName: string;
}) {
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState("");
	const commit = () => {
		const rule = oneLine(draft, RULE_MAX_CHARS);
		if (rule && !rules.includes(rule)) onChange([...rules, rule]);
		setDraft("");
		setAdding(false);
	};
	return (
		<div data-testid={testid} className="flex flex-wrap items-center gap-1.5">
			{rules.map((rule) => (
				<span key={rule} className="flex max-w-full items-center gap-2 bg-tone-2 py-[5px] pl-[11px] pr-[9px] text-[13px] text-ink">
					<span className="min-w-0 break-words">{rule}</span>
					{saved[rule] && (
						<span title={`Saved by ${teacherName} on ${savedDay(saved[rule])}`} className="shrink-0 text-xs whitespace-nowrap text-ink-3">
							Saved by {teacherName}
						</span>
					)}
					<button
						type="button"
						aria-label={`Remove rule: ${rule}`}
						className="lh-press shrink-0 text-ink-2 hover:text-ink"
						onClick={() => onChange(rules.filter((r) => r !== rule))}
					>
						<XIcon className="size-3" aria-hidden />
					</button>
				</span>
			))}
			{adding ? (
				<input
					type="text"
					autoFocus
					value={draft}
					maxLength={RULE_MAX_CHARS}
					aria-label="New rule"
					placeholder="Type a rule"
					data-testid={testid ? `${testid}-input` : undefined}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") commit();
						if (e.key === "Escape") {
							// The dialog behind closes on Escape; this one only cancels.
							e.stopPropagation();
							setDraft("");
							setAdding(false);
						}
					}}
					className="h-[30px] min-w-60 flex-1 border border-tone-2 bg-background px-2.5 text-[13px] text-ink placeholder:text-ink-3 focus-visible:border-ink-3"
				/>
			) : (
				rules.length < RULES_MAX && (
					<button
						type="button"
						data-testid={testid ? `${testid}-add` : undefined}
						className="lh-press flex items-center gap-1.5 px-[9px] py-[5px] text-[13px] text-ink-2 hover:text-ink"
						onClick={() => setAdding(true)}
					>
						<PlusIcon className="size-[13px]" aria-hidden />
						{addLabel}
					</button>
				)
			)}
		</div>
	);
}

/** "Oct 30". */
function savedDay(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
