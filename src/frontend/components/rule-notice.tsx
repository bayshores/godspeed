/**
 * The corner notice when an outside agent saves a rule from the terminal:
 * "Claude Code saved a rule", the rule, where it applies, Undo and Edit.
 * It hides after a while, but not while the pointer is on it, focus is
 * in it or the rule is being edited.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkCheckIcon } from "lucide-react";
import { parseWhere, type RuleWhere } from "@/shared/core";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { RuleEditBox, useSavedRule } from "@/frontend/components/saved-rule";
import { useServerEvent } from "@/frontend/components/server-events";
import { useHeld } from "@/frontend/components/use-held";

const SHOW_MS = 12_000;
const AFTER_UNDO_MS = 3_000;

interface Saved {
	key: number;
	agent: string;
	text: string;
	label: string;
	where: RuleWhere;
}

export function RuleNotice() {
	const [saved, setSaved] = useState<Saved | null>(null);
	useServerEvent("rules-changed", ({ saved: next }) => {
		const where = parseWhere(next?.where);
		if (next && where) setSaved({ key: Date.now(), agent: next.agent, text: next.text, label: next.label, where });
	});
	if (!saved || typeof document === "undefined") return null;
	return createPortal(<Card key={saved.key} saved={saved} onDone={() => setSaved(null)} />, document.getElementById(NOTICE_STACK_ID) ?? document.body);
}

function Card({ saved, onDone }: { saved: Saved; onDone: () => void }) {
	const api = useSavedRule(saved.where, saved.text);
	const { held, handlers } = useHeld();
	const { mode } = api;
	useEffect(() => {
		if (held || mode.kind === "editing") return;
		const id = window.setTimeout(onDone, mode.kind === "removed" ? AFTER_UNDO_MS : SHOW_MS);
		return () => window.clearTimeout(id);
	}, [held, mode.kind, onDone]);

	return (
		<div
			data-testid="rule-notice"
			role="status"
			{...handlers}
			className="lh-rise lh-popup flex w-[340px] max-w-full flex-col gap-2 px-4 py-3 font-ui text-[13.5px] text-ink"
		>
			<p className="flex items-center gap-2 font-bold">
				<BookmarkCheckIcon className="size-3.5 shrink-0" aria-hidden />
				{mode.kind === "removed" ? "Rule removed" : `${saved.agent} saved a rule`}
			</p>
			{mode.kind === "editing" ? (
				<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
					<RuleEditBox api={api} draft={mode.draft} />
				</div>
			) : (
				<>
					<p className={mode.kind === "removed" ? "text-ink-2 line-through" : undefined}>{api.rule}</p>
					<p className="text-xs text-ink-3">{saved.label}</p>
				</>
			)}
			{mode.kind === "error" && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{mode.message}
				</p>
			)}
			{(mode.kind === "saved" || mode.kind === "error") && (
				<div className="flex gap-2 pt-1">
					<button type="button" data-testid="rule-notice-undo" disabled={api.busy} onClick={api.undo} className="lh-press border border-tone-2 px-3 py-1 text-[13px] font-bold hover:bg-tone disabled:opacity-50">
						Undo
					</button>
					<button type="button" data-testid="rule-notice-edit" disabled={api.busy} onClick={api.edit} className="lh-press border border-tone-2 px-3 py-1 text-[13px] font-bold hover:bg-tone disabled:opacity-50">
						Edit
					</button>
				</div>
			)}
		</div>
	);
}
