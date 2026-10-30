/**
 * Keyboard shortcuts — the single source of truth for every app action that
 * has a binding. This module is PURE (no React, no window access at module
 * scope beyond the guarded helpers) so it can render a cheat sheet, match
 * events, and drive the user-editable key map without touching any component.
 *
 * Design:
 * - Tab is DEAD: browser tab-focus navigation is abandoned entirely. Tab
 *   does nothing.
 * - Esc is a layered dismiss: topmost popover (each popover stopPropagation's
 *   its own Esc) → abort in-flight turn.
 * - The key map persists overrides in localStorage (`lh:keymap`, overrides
 *   only) merged over the default bindings.
 *
 * Binding strings are normalized, cross-platform:
 *   "mod+d"    — mod = ⌘ on macOS, Ctrl elsewhere (both are accepted live)
 *   "shift+tab", "alt+arrowdown", "mod+shift+f", "?", "f2", "escape"
 * Order is fixed: mod, alt, shift, then the key.
 */

export type KeyAction =
	| "toggle-sidebar"
	| "sessions-search"
	| "jump-graph"
	| "new-session"
	| "rename-session"
	| "cheat-sheet"
	| "find"
	| "question-focus"
	| "question-next-row"
	| "question-prev-row"
	| "question-pick-row"
	| "question-submit"
	| "open-settings"
	| "toggle-user-thinking";

/** Where the cheat sheet groups an action (display only — dispatch is
 *  global; a seam that isn't mounted simply no-ops). */
export type KeyScope = "global" | "chat" | "graph";

interface KeyActionDef {
	id: KeyAction;
	/** Cheat-sheet label. */
	label: string;
	scope: KeyScope;
	binding: string;
	/** Display-only (cheat sheet) — contextual keys a SURFACE owns (the
	 *  question dock's row machine); never dispatched from the registry,
	 *  so they can't leak to pages where the surface isn't mounted. */
	displayOnly?: boolean;
}

export const KEYBOARD_ACTIONS: readonly KeyActionDef[] = [
	{ id: "open-settings", label: "Open settings", scope: "global", binding: "mod+," },
	{ id: "toggle-sidebar", label: "Toggle sidebar", scope: "global", binding: "mod+b" },
	{ id: "sessions-search", label: "Search lessons", scope: "global", binding: "mod+shift+f" },
	{ id: "jump-graph", label: "Graph view", scope: "global", binding: "mod+g" },
	{ id: "new-session", label: "New lesson", scope: "global", binding: "mod+n" },
	{ id: "rename-session", label: "Rename lesson", scope: "chat", binding: "f2" },
	{ id: "toggle-user-thinking", label: "Toggle all your thinking", scope: "chat", binding: "mod+t" },
	// Mod+F is surface-scoped: graph node search and session text Find share
	// one action/binding. Only the currently mounted surface listens.
	{ id: "find", label: "Find", scope: "global", binding: "mod+f" },
	{ id: "cheat-sheet", label: "Shortcut cheat sheet", scope: "global", binding: "?" },
	// The question dock's row machine — displayOnly: the dock owns
	// the keys while a question is expanded; the registry never dispatches
	// them, so bare arrows stay free everywhere else.
	{ id: "question-focus", label: "Question · focus thinking ↔ rows", scope: "chat", binding: "tab", displayOnly: true },
	{ id: "question-next-row", label: "Question · next row", scope: "chat", binding: "arrowdown", displayOnly: true },
	{ id: "question-prev-row", label: "Question · previous row", scope: "chat", binding: "arrowup", displayOnly: true },
	{ id: "question-pick-row", label: "Question · pick row", scope: "chat", binding: "space", displayOnly: true },
	{ id: "question-submit", label: "Question · submit", scope: "chat", binding: "enter", displayOnly: true },
];

const STORAGE_KEY = "lh:keymap";

/** localStorage overrides ({actionId: binding}), written by the settings
 *  editor. Guarded: SSR and a
 *  corrupt/absent store both fall back to defaults. */
export function loadOverrides(): Partial<Record<KeyAction, string>> {
	if (typeof window === "undefined") return {};
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Partial<Record<KeyAction, string>>;
		if (parsed && typeof parsed === "object") return parsed;
	} catch {
		/* corrupt store = defaults */
	}
	return {};
}

/** Write the full overrides map ({actionId: binding}) — the settings
 *  editor's rebind/reset persistence. Guarded: SSR no-ops. An empty
 *  map clears the store entirely (all-defaults). */
export function saveOverrides(overrides: Partial<Record<KeyAction, string>>): void {
	if (typeof window === "undefined") return;
	try {
		if (Object.keys(overrides).length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
		else window.localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* storage unavailable = overrides don't persist, defaults keep working */
	}
}

/** The live key map: defaults with user overrides applied. */
function effectiveKeymap(): Map<string, KeyAction> {
	const overrides = loadOverrides();
	const map = new Map<string, KeyAction>();
	for (const def of KEYBOARD_ACTIONS) {
		if (def.displayOnly) continue; // surface-owned, never dispatched
		const binding = overrides[def.id] ?? def.binding;
		if (typeof binding === "string" && binding) map.set(binding, def.id);
	}
	return map;
}

/** Which action a normalized binding fires, if any (override-aware). */
export function actionForBinding(binding: string): KeyAction | undefined {
	return effectiveKeymap().get(binding);
}

/** The effective (override-aware) binding for one action — display use. */
export function bindingForAction(id: KeyAction): string {
	const overrides = loadOverrides();
	const def = KEYBOARD_ACTIONS.find((a) => a.id === id);
	if (!def) return "";
	return overrides[id] ?? def.binding;
}

/**
 * Normalize a KeyboardEvent to a canonical binding string. Rules:
 * - mod matches BOTH meta (⌘) and ctrl — Ctrl+K works on a Mac keyboard too.
 * - a printable key ("?") bakes its shift in: "shift+/?" collapses to "?".
 */
export function eventBinding(e: KeyboardEvent): string {
	const mod = e.metaKey || e.ctrlKey;
	// A bare printable key bakes its shift into the character ("?" not
	// "shift+/"), so it returns alone. With a real modifier riding along,
	// shift is explicit (⌘⇧F = "mod+shift+f"); non-printable keys (Tab,
	// arrows) always keep their shift (Shift+Tab = "shift+tab").
	if (e.key.length === 1 && !mod && !e.altKey) return e.key.toLowerCase();
	const mods: string[] = [];
	if (mod) mods.push("mod");
	if (e.altKey) mods.push("alt");
	if (e.shiftKey) mods.push("shift");
	return [...mods, e.key.toLowerCase()].join("+");
}

/** The window event name a registry action dispatches/answers on —
 *  the ONE spelling shared by the dispatcher (keyboard-shortcuts) and
 *  every surface listener, so a name mismatch (a shortcut that silently
 *  does nothing) is structurally impossible.
 */
export function kbdEventForAction(action: KeyAction): string {
	return `lh:kbd-${action}`;
}

/** True when the event lands in a typing surface (input, textarea, or a
 *  contentEditable). In one, only mod/alt combos (and Tab, which types
 *  nothing) may fire — bare keys belong to the field (typing, caret). */
export function isTypingSurface(e: KeyboardEvent): boolean {
	const target = e.target as HTMLElement | null;
	if (!target) return false;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	return target.isContentEditable;
}

/** macOS styling for binding display ("⌘D", "⇧⇥", "⌥↑"). */
export const IS_MAC =
	typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

const MOD_GLYPH = IS_MAC ? "⌘" : "Ctrl+";
const ALT_GLYPH = IS_MAC ? "⌥" : "Alt+";
const SHIFT_GLYPH = IS_MAC ? "⇧" : "Shift+";

const KEY_GLYPH: Record<string, string> = {
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
	enter: "↵",
	tab: "⇥",
	escape: "Esc",
	space: "Space",
};

/** Format a binding for display: "mod+shift+f" → "⌘⇧F". */
export function formatBinding(binding: string): string {
	const parts = binding.split("+");
	const key = parts.pop()!; // last part is always the key
	const glyphs: string[] = [];
	for (const part of parts) {
		if (part === "mod") glyphs.push(MOD_GLYPH);
		else if (part === "alt") glyphs.push(ALT_GLYPH);
		else if (part === "shift") glyphs.push(SHIFT_GLYPH);
	}
	const keyGlyph = KEY_GLYPH[key] ?? key.toUpperCase();
	return glyphs.join("") + keyGlyph;
}
