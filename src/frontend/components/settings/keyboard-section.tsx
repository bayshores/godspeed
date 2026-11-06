/**
 * The Keyboard section: view / rebind / reset over
 * core/keyboard.ts's registry. The overrides persist in localStorage
 * (overrides only, merged over DEFAULT_BINDINGS), so rebinding
 * is INSTANT — the dispatcher reads the map per keydown, no reload.
 *
 * Rebind flow: click Rebind → the row listens for the next keydown
 * (capture phase, preventDefault — nothing types anywhere), eventBinding
 * normalizes it, saveOverrides persists. Escape cancels. displayOnly
 * actions (a surface owns those keys — the question dock's row machine)
 * are listed for reading but never rebindable.
 *
 * No conflict detection: if a new binding collides with another action's,
 * the first match in registry order wins; the cheat sheet shows both.
 */

import { useEffect, useState } from "react";
import {
	KEYBOARD_ACTIONS,
	KEY_SCOPES,
	eventBinding,
	formatBinding,
	loadOverrides,
	saveOverrides,
	type KeyAction,
} from "@/shared/core";
import { SettingsRow } from "./controls.tsx";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";

/** The overrides map after ONE change (pure — exported for tests):
 *  binding null = reset the action to its default (key removed). */
export function nextOverrides(
	current: Partial<Record<KeyAction, string>>,
	id: KeyAction,
	binding: string | null,
): Partial<Record<KeyAction, string>> {
	const next = { ...current };
	if (binding === null) delete next[id];
	else next[id] = binding;
	return next;
}

export function KeyboardSection() {
	const [overrides, setOverrides] = useState<Partial<Record<KeyAction, string>>>({});
	const [rebinding, setRebinding] = useState<KeyAction | null>(null);
	const [nonce, setNonce] = useState(0);

	// localStorage is read post-mount (SSR-safe); `nonce` re-reads after writes.
	useEffect(() => {
		setOverrides(loadOverrides());
	}, [nonce]);

	// The capture listener — only while a rebind is armed.
	useEffect(() => {
		if (!rebinding) return;
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Escape") {
				setRebinding(null);
				return;
			}
			// Modifier keydowns arrive one by one (⌘ down, then ⇧, then the
			// key) — each is a keydown this capture listener sees. They are
			// not bindings; keep listening for the real key.
			if (e.key === "Control" || e.key === "Meta" || e.key === "Alt" || e.key === "Shift") return;
			const binding = eventBinding(e);
			if (!binding) return;
			const next = nextOverrides(loadOverrides(), rebinding, binding);
			saveOverrides(next);
			setRebinding(null);
			setNonce((n) => n + 1);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [rebinding]);

	function resetOne(id: KeyAction) {
		saveOverrides(nextOverrides(loadOverrides(), id, null));
		setNonce((n) => n + 1);
	}

	function resetAll() {
		saveOverrides({});
		setNonce((n) => n + 1);
	}

	const overridden = (id: KeyAction) => overrides[id] !== undefined;

	return (
		<>
			{KEY_SCOPES.map(({ scope, label }) => {
				const actions = KEYBOARD_ACTIONS.filter((a) => a.scope === scope);
				if (!actions.length) return null;
				return (
					<div key={scope} data-testid={`kbd-scope-${scope}`} className="mt-[22px] first:mt-0">
						<p className={cn("pb-2", LABEL_TEXT)}>{label}</p>
						<div className="flex flex-col gap-0.5">
							{actions.map((def) => {
								const effective = overrides[def.id] ?? def.binding;
								return (
									<SettingsRow
										key={def.id}
										label={def.label}
										testid={`kbd-row-${def.id}`}
									>
										<span className="flex items-center gap-2">
											<kbd className="border border-tone-2 bg-background px-1.5 py-0.5 font-mono text-xs text-ink">
												{rebinding === def.id ? "Press keys…" : formatBinding(effective)}
											</kbd>
											{def.displayOnly ? null : rebinding === def.id ? (
												<button
													type="button"
													onClick={() => setRebinding(null)}
													className="lh-press text-xs text-ink-3 underline-offset-2 hover:text-foreground hover:underline"
												>
													Cancel
												</button>
											) : (
												<>
													<button
														type="button"
														onClick={() => setRebinding(def.id)}
														data-testid={`kbd-rebind-${def.id}`}
														className="lh-press text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
													>
														Rebind
													</button>
													{overridden(def.id) && (
														<button
															type="button"
															onClick={() => resetOne(def.id)}
															data-testid={`kbd-reset-${def.id}`}
															className="lh-press text-xs text-ink-3 underline-offset-2 hover:text-foreground hover:underline"
														>
															Reset
														</button>
													)}
												</>
											)}
										</span>
									</SettingsRow>
								);
							})}
						</div>
						{actions.some((a) => a.displayOnly) && (
							<p data-testid={`kbd-fixed-${scope}`} className="pt-2 text-xs text-ink-3">
								The question keys can't be changed.
							</p>
						)}
					</div>
				);
			})}
			<div className="mt-4 flex justify-end">
				<button
					type="button"
					onClick={resetAll}
					data-testid="kbd-reset-all"
					className="lh-press text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				>
					Reset all to defaults
				</button>
			</div>
		</>
	);
}