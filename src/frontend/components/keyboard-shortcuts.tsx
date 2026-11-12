/**
 * Keyboard shortcuts — the single document-level keydown listener. Owns the pieces that belong to no surface in particular:
 *
 * - Tab moves focus as usual; an open modal dialog keeps it inside
 *   (trapTabInDialog in focus-hygiene.ts).
 * - Esc is a layered dismiss: topmost popover first (popovers stopPropagation
 *   on their own Esc — usePopoverDismiss), then abort of an
 *   in-flight turn.
 * - Global actions dispatch lh:kbd-<action> window events; surfaces that are
 *   mounted listen (the lh:chat-renamed pattern). A surface that isn't
 *   mounted simply doesn't listen — an F2 on the graph view is a no-op, not
 *   an error. Actions live in src/shared/core/keyboard.ts (registry + persisted
 *   overrides), the ONE table.
 *
 * Listeners attach at the WINDOW level (bubble's last stop) so every
 * component-level handler — popovers' own Esc, the composer's Esc — gets the
 * event first and can claim it with stopPropagation.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { actionForBinding, bindingForAction, bindingKeys, eventBinding, isTypingSurface, kbdEventForAction, KEYBOARD_ACTIONS, KEY_SCOPES } from "@/shared/core";
import { showFocusRingAfterTab, trapTabInDialog } from "@/frontend/components/focus-hygiene";
import { usePresence } from "@/frontend/components/presence";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";

export function KeyboardShortcuts() {
	const router = useRouter();
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const presence = usePresence(shortcutsOpen);

	// The router inside a ref so the keydown listener (attached once) never
	// goes stale.
	const routerRef = useRef(router);
	routerRef.current = router;

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// THE ONE-ESC LAW: one Esc, one action, on the topmost active
				// layer. Field-level handlers claim at their element (focus in
				// a field: the field's action); every SURFACED layer (popovers,
				// plan, overlays, dialogs) claims at the DOCUMENT level, which
				// fires before this window listener — so reaching here means
				// NOTHING is surfaced and no field is focused. The fallback
				// aborts the turn (a server-side turn has no client request
				// to abort — the abort seam in Chat decides what's honestly
				// stoppable, layered by escAbortTarget).
				window.dispatchEvent(new CustomEvent("lh:kbd-abort-turn"));
				return;
			}

			// ── Registry dispatch.
			const action = actionForBinding(eventBinding(e));
			if (!action) return;

			// The input guard: inside a typing surface only mod/alt combos
			// fire (they never type a character). Bare keys — "?" included —
			// pass through so the field keeps them.
			if (isTypingSurface(e) && !(e.metaKey || e.ctrlKey || e.altKey)) return;

			// Dispatch: global commands we own run here; surface commands
			// ride the window event for the mounted surface to catch.
			switch (action) {
				case "new-session":
					routerRef.current.push("/new");
					break;
				case "open-settings":
					routerRef.current.push("/settings");
					break;
				case "jump-graph":
					routerRef.current.push("/graph");
					break;
				case "cheat-sheet":
					setShortcutsOpen(true);
					break;
				case "find":
					// The mounted surface owns Find (session text / graph nodes).
					// Claim Mod+F so Chromium's whole-window finder cannot open too.
					e.preventDefault();
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
					break;
				default:
					window.dispatchEvent(new CustomEvent(kbdEventForAction(action)));
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	// The desktop app's own menu opens Settings on a section.
	useEffect(() => window.lh?.onOpenSettings?.((section) => routerRef.current.push(`/settings?section=${encodeURIComponent(section)}`)), []);

	useEffect(() => {
		document.addEventListener("keydown", trapTabInDialog, true);
		const stopRing = showFocusRingAfterTab(document);
		return () => {
			document.removeEventListener("keydown", trapTabInDialog, true);
			stopRing();
		};
	}, []);

	if (!presence.mounted) return null;
	return createPortal(
		<DialogSheet title="Keyboard shortcuts" state={presence.state} testid="shortcuts" onClose={() => setShortcutsOpen(false)} className="w-[780px]">
			<ShortcutList />
		</DialogSheet>,
		document.body,
	);
}

/** Every shortcut with its keys, one column per place it works in. */
function ShortcutList() {
	return (
		<div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
			{KEY_SCOPES.map(({ scope, label }) => (
				<div key={scope} className="flex flex-col gap-0.5">
					<h3 className="text-lg text-ink">{label}</h3>
					<div className="h-[1.5px] bg-ink" />
					{KEYBOARD_ACTIONS.filter((a) => a.scope === scope).map((a) => (
						<div key={a.id} className="flex items-center justify-between gap-4 py-1.5 text-[15px] text-ink">
							{a.label}
							<span className="flex shrink-0 gap-1.5">
								{bindingKeys(bindingForAction(a.id)).map((key, i) => (
									<kbd key={i} className="rounded-[2px] border-[1.5px] border-ink bg-background px-2 py-0.5 font-[inherit] text-sm">
										{key}
									</kbd>
								))}
							</span>
						</div>
					))}
				</div>
			))}
		</div>
	);
}
