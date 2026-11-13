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
import { SettingsGroup, SettingsRow } from "./controls.tsx";
import { cn } from "@/frontend/lib/utils";

const KEY = "inline-flex h-8 min-w-10 items-center justify-center rounded border border-edge bg-background px-2 text-[15px] text-ink";
const FIXED_KEYS_HINT = "Switch between thinking and options, next, previous, pick, submit. These can't be changed.";

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
				const fixed = actions.filter((a) => a.displayOnly);
				return (
					<SettingsGroup key={scope} label={label} testid={`kbd-scope-${scope}`}>
						{actions
							.filter((a) => !a.displayOnly)
							.map((def) => {
								const effective = overrides[def.id] ?? def.binding;
								return (
									<SettingsRow key={def.id} label={def.label} testid={`kbd-row-${def.id}`}>
										<span className="flex items-center gap-2">
											{rebinding !== def.id && overridden(def.id) && (
												<button type="button" onClick={() => resetOne(def.id)} data-testid={`kbd-reset-${def.id}`} className="lh-btn lh-btn-quiet text-[15px]">
													Reset
												</button>
											)}
											<kbd className={cn(KEY, "min-w-24")}>{rebinding === def.id ? "Press keys…" : formatBinding(effective)}</kbd>
											{rebinding === def.id ? (
												<button type="button" onClick={() => setRebinding(null)} className="lh-btn text-[15px]">
													Cancel
												</button>
											) : (
												<button type="button" onClick={() => setRebinding(def.id)} data-testid={`kbd-rebind-${def.id}`} className="lh-btn text-[15px]">
													Rebind
												</button>
											)}
										</span>
									</SettingsRow>
								);
							})}
						{fixed.length > 0 && (
							<SettingsRow label="Answering a question" hint={FIXED_KEYS_HINT} testid={`kbd-fixed-${scope}`}>
								<span className="flex items-center gap-2">
									{fixed.map((def) => (
										<kbd key={def.id} data-testid={`kbd-row-${def.id}`} className={KEY}>
											{formatBinding(def.binding)}
										</kbd>
									))}
								</span>
							</SettingsRow>
						)}
					</SettingsGroup>
				);
			})}
			<div className="flex items-center justify-between gap-4">
				<span className="text-[15px] text-ink-2">Stored on this device</span>
				<button type="button" onClick={resetAll} data-testid="kbd-reset-all" className="lh-btn text-[15px]">
					Reset all to defaults
				</button>
			</div>
		</>
	);
}
