"use client";

/**
 * The corner notice when an outside agent saves a rule from the terminal:
 * "Claude Code saved a rule", the rule, where it applies, Undo and Edit.
 * It hides after a while, but not while the pointer is on it, focus is
 * in it or the rule is being edited.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { parseWhere, type RuleWhere } from "@/shared/core";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { RuleEditBox, useSavedRule } from "@/frontend/components/saved-rule";
import { useServerEvent } from "@/frontend/components/server-events";
import { useHeld } from "@/frontend/components/use-held";
import { cn } from "@/frontend/lib/utils";

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
		<NoticeCard
			data-testid="rule-notice"
			role="status"
			{...handlers}
			title={mode.kind === "removed" ? "Rule removed" : `${saved.agent} saved a rule`}
			actions={
				(mode.kind === "saved" || mode.kind === "error") && (
					<>
						<button type="button" data-testid="rule-notice-undo" disabled={api.busy} onClick={api.undo} className="lh-press lh-btn text-[15px]">
							Undo
						</button>
						<button type="button" data-testid="rule-notice-edit" disabled={api.busy} onClick={api.edit} className="lh-press lh-btn text-[15px]">
							Edit
						</button>
					</>
				)
			}
		>
			{mode.kind === "editing" ? (
				<div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-ink">
					<RuleEditBox api={api} draft={mode.draft} />
				</div>
			) : (
				<>
					<p className={cn("border border-border bg-tone px-2.5 py-2 text-[15px] text-ink", mode.kind === "removed" && "text-ink-2 line-through")}>{api.rule}</p>
					<NoticeText>{saved.label}</NoticeText>
				</>
			)}
			{mode.kind === "error" && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{mode.message}
				</p>
			)}
		</NoticeCard>
	);
}
