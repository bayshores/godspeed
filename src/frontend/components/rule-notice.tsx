/**
 * The corner notice when the teacher saves a rule from the teacher panel's chat:
 * "Teacher saved a rule" (by the teacher's name), the rule, where it applies, Undo and Edit.
 * It hides after a while, but not while the pointer is on it, focus is
 * in it or the rule is being edited.
 */

import { useState } from "react";
import { DEFAULT_TEACHER_NAME, parseWhere, type RuleWhere } from "@/shared/core";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { InNoticeStack } from "@/frontend/components/strip/peek-sheet";
import { RuleEditBox, useSavedRule } from "@/frontend/components/saved-rule";
import { useServerEvent } from "@/frontend/components/server-events";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useHeld } from "@/frontend/components/use-held";
import { cn } from "@/frontend/lib/utils";
import { ErrorLine } from "@/frontend/components/error-line";

const SHOW_MS = 12_000;
const AFTER_UNDO_MS = 3_000;

interface Saved {
	key: number;
	text: string;
	label: string;
	where: RuleWhere;
}

export function RuleNotice() {
	const [saved, setSaved] = useState<Saved | null>(null);
	useServerEvent("rules-changed", ({ saved: next }) => {
		const where = parseWhere(next?.where);
		if (next && where) setSaved({ key: Date.now(), text: next.text, label: next.label, where });
	});
	if (!saved || typeof document === "undefined") return null;
	return (
		<InNoticeStack>
			<Card key={saved.key} saved={saved} onDone={() => setSaved(null)} />
		</InNoticeStack>
	);
}

function Card({ saved, onDone }: { saved: Saved; onDone: () => void }) {
	const api = useSavedRule(saved.where, saved.text);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const { mode } = api;
	const handlers = useHeld(mode.kind === "editing" ? null : mode.kind === "removed" ? AFTER_UNDO_MS : SHOW_MS, onDone, mode.kind);

	return (
		<NoticeCard
			data-testid="rule-notice"
			timed
			{...handlers}
			title={mode.kind === "removed" ? "Rule removed" : `${teacher} saved a rule`}
			actions={
				(mode.kind === "saved" || mode.kind === "error") && (
					<>
						<button type="button" data-testid="rule-notice-undo" disabled={api.busy} onClick={api.undo} className="lh-btn">
							Undo
						</button>
						<button type="button" data-testid="rule-notice-edit" disabled={api.busy} onClick={api.edit} className="lh-btn">
							Edit
						</button>
					</>
				)
			}
		>
			{mode.kind === "editing" ? (
				<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-(length:--text-sm) text-ink">
					<RuleEditBox api={api} draft={mode.draft} />
				</div>
			) : (
				<>
					<p className={cn("lh-well lh-notch px-2.5 py-2 text-ui text-ink", mode.kind === "removed" && "text-ink-2 line-through")}>{api.rule}</p>
					<NoticeText>{saved.label}</NoticeText>
				</>
			)}
			<ErrorLine error={mode.kind === "error" ? mode.message : null} className="text-(length:--text-sm) text-ans-wrong" />
		</NoticeCard>
	);
}
