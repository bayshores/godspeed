"use client";

/**
 * Undo and Edit for a rule an agent just saved, shared by the chat line
 * (lessons) and the corner notice (the terminal). Edit turns the rule into
 * a text box with Save and Cancel.
 */

import { useState } from "react";
import { RULE_MAX_CHARS, type RuleWhere } from "@/core";

type Mode = { kind: "saved" } | { kind: "editing"; draft: string } | { kind: "removed" } | { kind: "error"; message: string };

async function postRule(body: { action: "remove" | "edit"; where: RuleWhere; text: string; newText?: string }): Promise<{ ok: true; rule?: string } | { ok: false; error: string }> {
	try {
		const res = await fetch("/api/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		const json = (await res.json().catch(() => ({}))) as { rule?: string; error?: string };
		return res.ok ? { ok: true, rule: json.rule } : { ok: false, error: json.error ?? "Couldn't change the rule. Try again." };
	} catch {
		return { ok: false, error: "Couldn't reach godspeed. Try again." };
	}
}

export function useSavedRule(where: RuleWhere, saved: string) {
	const [rule, setRule] = useState(saved);
	const [mode, setMode] = useState<Mode>({ kind: "saved" });
	const [busy, setBusy] = useState(false);
	const run = async (body: Parameters<typeof postRule>[0], after: (rule?: string) => void) => {
		setBusy(true);
		const out = await postRule(body);
		setBusy(false);
		if (out.ok) after(out.rule);
		else setMode({ kind: "error", message: out.error });
	};
	return {
		rule,
		mode,
		busy,
		undo: () => void run({ action: "remove", where, text: rule }, () => setMode({ kind: "removed" })),
		edit: () => setMode({ kind: "editing", draft: rule }),
		setDraft: (draft: string) => setMode({ kind: "editing", draft }),
		cancel: () => setMode({ kind: "saved" }),
		save: (draft: string) => {
			if (draft.trim() === rule) return setMode({ kind: "saved" });
			void run({ action: "edit", where, text: rule, newText: draft }, (next) => {
				if (next) setRule(next);
				setMode({ kind: "saved" });
			});
		},
	};
}

type SavedRuleApi = ReturnType<typeof useSavedRule>;

/** The text box Edit opens, with Save and Cancel. */
export function RuleEditBox({ api, draft }: { api: SavedRuleApi; draft: string }) {
	return (
		<>
			<input
				type="text"
				autoFocus
				value={draft}
				maxLength={RULE_MAX_CHARS}
				aria-label="Rule"
				data-testid="saved-rule-input"
				onChange={(e) => api.setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") api.save(draft);
					if (e.key === "Escape") {
						e.stopPropagation();
						api.cancel();
					}
				}}
				className="h-[28px] min-w-0 flex-1 basis-60 border border-tone-2 bg-background px-2 text-[13px] text-ink focus-visible:border-ink-3"
			/>
			<button type="button" data-testid="saved-rule-save" disabled={api.busy || !draft.trim()} onClick={() => api.save(draft)} className="lh-press font-bold text-ink disabled:opacity-50">
				Save
			</button>
			<button type="button" onClick={api.cancel} className="lh-press font-bold text-ink-2 hover:text-ink">
				Cancel
			</button>
		</>
	);
}
