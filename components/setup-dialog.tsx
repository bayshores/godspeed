"use client";
/**
 * The first-run setup flow (model-slots wave, 2026-09-20, owner design
 * "A — composer CTA + send interception"): chats cannot start until the
 * user has picked all three model slots — there are no defaults. The
 * graph view's new-session dock (the app's home, where
 * chats start) shows a "Set up your models" CTA while unconfigured;
 * submitting a topic — or sending on /chat/new — opens THIS dialog with
 * the draft preserved; Save stores the slots — the draft WAITS in the
 * composer, the learner sends it themselves (owner ruling 2026-10-09:
 * saving models must never send the message).
 *
 * STAGED BY DEPENDENCY (owner, 2026-09-20: first a connection, then
 * models — there are no models to pick before a subscription is signed
 * in; API keys were removed):
 *   Stage 1 — no connected subscription: a SELF-CONTAINED connect screen
 *     (the subscription sign-ins). The dialog STAYS MOUNTED — a
 *     connection change dispatches the "providers" signal, the fetch
 *     effect re-runs on it, and the stage flips to the pickers on its
 *     own; the draft lives in the caller's state, untouched throughout.
 *   Stage 2 — Strong → Cheap → Vision pickers over the FEDERATED catalog
 *     (connected subscriptions only), the vision slot filtered to image-capable
 *     models, in the app's shared dropdown language (ModelMenuList).
 *     All three required (owner: no skip, no defaults); Save PUTs the
 *     models section and reports onDone(models).
 *
 * Closable without configuring (Esc/backdrop/✕) — browsing the app stays
 * possible; the GATE is the send interception, not the dialog. The
 * settings-dialog visual language: dim backdrop, border rounded-md card,
 * CMU title, z-50.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import type React from "react";
import { providerHidesThinking, type ModelCatalogEntry, type ModelSlotName, type ModelsSettings } from "@/src/core";
import { prettyModel } from "@/components/usage-format";
import { ModelMenuList } from "@/components/settings/model-menu";
import { MenuShell } from "@/components/menu-shell";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { Hint } from "@/components/ui/hint";
import { ChatGPTBackgroundAccess } from "@/components/settings/chatgpt-connection";
import { NativeSubscriptionBackgroundAccess, SubscriptionConnections } from "@/components/settings/subscription-connections";
import { defaultOrderLevel, populateLevel, THINKING_LABEL } from "@/components/thinking-default";
import { ThinkingMenuList } from "@/components/settings/model-menu";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/** The pickers' slot identity — same roster language as the Agent
 *  section's slot rows. */
const SLOT_META: Record<ModelSlotName, { label: string; roster: string }> = {
	strong: { label: "Strong", roster: "Prober, teacher" },
	cheap: { label: "Cheap", roster: "Researcher, demo builder, extractor, auditor" },
	vision: { label: "Vision", roster: "Visual maker + PDF reader" },
};
const SLOT_ORDER: readonly ModelSlotName[] = ["strong", "cheap", "vision"];

/** The GET /api/models response fields the flow consumes. */
interface ModelsBody {
	models: ModelCatalogEntry[];
	providers: { id: string; connected: boolean }[];
	/** The three tiers' RESOLVED pins (BYOK: NULL per unset tier) — the
	 *  PREFILL + "needed" marks (owner, 2026-09-22): pinned tiers open
	 *  with their pick, unpinned tiers carry the mark. */
	slots?: Record<ModelSlotName, { model: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } | null>;
}

/** Pure: which stage the flow opens at — no connected subscription =
 *  connect first (owner's dependency ordering). Exported for tests. */
export function setupStage(
	providers: { id: string; connected: boolean }[] | null,
): "connect" | "pickers" {
	if (providers === null) return "connect"; // fetch failed → the honest fallback
	return providers.some((p) => p.connected) ? "pickers" : "connect";
}

/** Prefill (owner, BYOK wave 2026-09-22): each pinned tier opens with its
 *  pick — matched in the FEDERATED catalog (a signed-out provider's pin
 *  does not prefill); unpinned tiers stay empty and carry the "needed" mark.
 *  First-run = nothing pinned → all three empty + marked. Exported pure
 *  for tests. */
export function prefillFromSlots(
	models: ModelCatalogEntry[],
	slots: Record<ModelSlotName, { model: { provider: string; id: string } } | null> | undefined,
): Partial<Record<ModelSlotName, ModelCatalogEntry>> {
	const pre: Partial<Record<ModelSlotName, ModelCatalogEntry>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = slots?.[slot];
		const entry = pin?.model
			? models.find((m) => m.provider === pin.model!.provider && m.id === pin.model!.id)
			: undefined;
		if (entry) pre[slot] = entry;
	}
	return pre;
}

/** Level prefill (chunk 2): a pinned tier opens with its STORED level
 *  as-is (Save clamps server-side if the ladder lapsed), else the
 *  ordering's level for that model — the level a fresh pick would
 *  populate (owner: the ordering's only purpose is first assignment).
 *  Exported pure for tests. */
export function prefillLevelFromPin(
	entry: ModelCatalogEntry,
	pin: { thinkingLevel?: ThinkingLevel } | null | undefined,
): ThinkingLevel {
	return populateLevel(pin?.thinkingLevel, entry.supportedLevels);
}

/** Stage 1's pure body — exported for SSR pins (the delete/settings
 *  body pattern): the subscription sign-ins, nothing else (API keys were
 *  removed). The wrapper owns state + effects + the portal. */
export function SetupConnectBody() {
	return (
		<div className="flex flex-col gap-3 px-6 py-5" data-testid="setup-stage-connect">
			<p className="text-xs text-muted-foreground">
				Sign in to a subscription. You’ll pick your models next.
			</p>
			<SubscriptionConnections setup />
		</div>
	);
}

export function SetupDialog({
	open,
	onClose,
	/** Saved: the models section landed; the caller marks configured (the
	 *  draft stays put — save never sends). */
	onDone,
}: {
	open: boolean;
	onClose: () => void;
	onDone: (models: ModelsSettings) => void;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	// Stays mounted through its fade-out (motion wave, owner 2026-10-26).
	const presence = usePresence(open);
	const [body, setBody] = useState<ModelsBody | null>(null);
	const [failed, setFailed] = useState(false);
	const [picked, setPicked] = useState<Partial<Record<ModelSlotName, ModelCatalogEntry>>>({});
	/** Per-slot thinking level (chunk 2): populated from the ordering on
	 *  every fresh model pick, editable — an explicit pick always wins. */
	const [levels, setLevels] = useState<Partial<Record<ModelSlotName, ThinkingLevel>>>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [openMenu, setOpenMenu] = useState<{ slot: ModelSlotName; kind: "model" | "thinking" } | null>(null);

	// The providers signal: the subscription controls dispatch it on every
	// connection change; the fetch effect below re-runs on it, so signing
	// in flips the stage to the pickers with the widened catalog — no
	// restart, no Settings round-trip.
	const [providersTick, setProvidersTick] = useState(0);
	useSettingsSaved((section) => {
		if (section === "providers") setProvidersTick((t) => t + 1);
	});

	// Fresh /api/models per open AND per connection change — a sign-in a
	// moment ago (stage 1's own screen) widens the pickers immediately.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setBody(null);
		setPicked({});
		setLevels({});
		setError(null);
		fetch("/api/models")
			.then((r) => { if (!r.ok) throw new Error("Catalog unavailable"); return r.json(); })
			.then((b: ModelsBody) => {
				if (cancelled) return;
				setBody(b);
				setFailed(false);
				// Prefill (owner, 2026-09-22): each pinned tier opens with its
				// pick (matched in the FEDERATED catalog — a signed-out
				// provider's pin does not prefill); unpinned tiers stay empty and carry the
				// "needed" mark. First-run = nothing pinned → all three marked.
				const pre = prefillFromSlots(b.models, b.slots);
				setPicked(pre);
				// Levels prefill with the pins (chunk 2): stored level if still
				// supported, else the ordering's level for the pinned model.
				const preLevels: Partial<Record<ModelSlotName, ThinkingLevel>> = {};
				for (const slot of SLOT_ORDER) {
					const entry = pre[slot];
					if (entry) preLevels[slot] = prefillLevelFromPin(entry, b.slots?.[slot]);
				}
				setLevels(preLevels);
			})
			.catch(() => { if (!cancelled) setFailed(true); });
		return () => { cancelled = true; };
	}, [open, providersTick]);

	// Esc + outside-click — layered dismissal, closable WITHOUT
	// configuring (browsing stays possible; the gate is the send
	// interception, not this dialog). An open slot menu eats Esc first
	// (and any click outside it); only a bare Esc closes the dialog.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// THE ONE-ESC LAW (owner, keyboard round 2026-10-06): claim at
			// the document level before the layered dismissal — every branch
			// below acts, so the window chain (abort) must
			// never also fire. One Esc, one action.
			e.preventDefault();
			e.stopPropagation();
			if (openMenu !== null) setOpenMenu(null);
			else onClose();
		};
		const onPointerDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element)) return;
			const t = e.target;
			if (openMenu === null) return;
			const triggerTestid =
				openMenu.kind === "model" ? `setup-trigger-${openMenu.slot}` : `setup-thinking-${openMenu.slot}`;
			if (t.closest("[data-lh-menu]") || t.closest(`[data-testid="${triggerTestid}"]`)) return;
			setOpenMenu(null);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open, onClose, openMenu]);

	if (!presence.mounted) return null;

	const stage = failed ? "connect" : setupStage(body ? body.providers : null);
	const allPicked = SLOT_ORDER.every((s) => picked[s]);

	async function save() {
		if (!allPicked || saving) return;
		setSaving(true);
		setError(null);
		const models: ModelsSettings = {};
		for (const slot of SLOT_ORDER) {
			const level = levels[slot];
			models[slot] = {
				model: { provider: picked[slot]!.provider, id: picked[slot]!.id },
				...(level ? { thinkingLevel: level } : {}),
			};
		}
		const res = await fetch("/api/settings/models", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(models),
		}).catch(() => null);
		if (!res || !res.ok) {
			setSaving(false);
			setError(res ? `Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}` : "Save failed. Check your connection and try again.");
			return;
		}
		notifySettingsSaved("models");
		onDone(models);
	}

	return createPortal(
		<div
			className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			data-testid="setup-backdrop"
			data-state={presence.state}
			inert={!open}
			{...backdropDismiss}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Set up your models"
				data-testid="setup-dialog"
				data-state={presence.state}
				className="lh-dialog flex max-h-[85vh] w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-md border border-border bg-card shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<header className="flex h-15 shrink-0 items-center gap-3 border-b border-border px-5">
					<h2 className="font-title text-2xl tracking-tight">Set up your models</h2>
					<Hint label="Close" binding="escape" side="left">
<button
						type="button"
						aria-label="Close setup"
						data-testid="setup-close"
						onClick={onClose}
						className="lh-press ml-auto text-muted-foreground hover:text-foreground"
					>
						✕
					</button>
</Hint>
				</header>

				{stage === "connect" ? (
					failed ? (
						<p className="px-6 py-5 text-sm text-foreground">
							Model catalog could not be loaded. Check the connection and retry.
						</p>
					) : (
						<SetupConnectBody />
					)
				) : (
					<div className="flex flex-col gap-4 overflow-y-auto px-6 py-5" data-testid="setup-stage-pickers">
						<p className="text-xs text-muted-foreground">
							Pick the model for each tier. All three are required before chats can start.
						</p>
						{SLOT_ORDER.map((slot) => {
							const entry = picked[slot];
							const level = levels[slot];
							const levelsForEntry = entry?.supportedLevels ?? [];
							const catalog =
								slot === "vision" ? body?.models.filter((m) => m.input.includes("image")) : body?.models;
							return (
								<div key={slot} data-testid={`setup-slot-${slot}`} className="flex flex-col gap-1.5">
									<span className="flex items-center gap-1.5">
										<span className="font-ui text-sm text-foreground">{SLOT_META[slot].label}</span>
										{!body?.slots?.[slot]?.model && !picked[slot] && (
											<span
												data-testid={`setup-needed-${slot}`}
												className="rounded-sm border border-border px-1 py-0.5 text-[10px] font-normal tracking-wide text-muted-foreground"
											>
												needed
											</span>
										)}
									</span>
									<span className="text-xs text-muted-foreground/70">{SLOT_META[slot].roster}</span>
									{slot !== "strong" && <><ChatGPTBackgroundAccess provider={entry?.provider} /><NativeSubscriptionBackgroundAccess provider={entry?.provider} /></>}
									<div className="flex items-center gap-2">
										<div className="relative flex-1">
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} model`}
												data-testid={`setup-trigger-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "model"}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "model" ? null : { slot, kind: "model" })}
												className="lh-press flex h-7 min-w-40 w-full items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground hover:border-muted-foreground/50"
											>
												<span className="min-w-0 flex-1 truncate">{entry ? prettyModel(entry.id) : "Pick a model…"}</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											{/* Anchor by TESTID, not a ref (the settings-section pattern):
											    React attaches a host element's ref AFTER its descendants'
											    layout effects run, so a ref freshly attached in this same
											    commit (menu opening = the ref condition turning true) is
											    still null when MenuShell measures — place() gives up, the
											    menu stays invisible, and only a window resize (which re-runs
											    place()) shows it. querySelector at place time has no such
											    ordering hazard. Live-caught by the owner 2026-10-09: every
											    setup picker opened dead until a window resize. */}
											<MenuShell
												open={open && openMenu?.slot === slot && openMenu.kind === "model"}
												anchorTestid={`setup-trigger-${slot}`}
												testid={`setup-menu-${slot}`}
												preferredSide="down"
												align="left"
												menuClass="flex w-[22rem] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
											>
												<ModelMenuList
													models={catalog}
													effectiveId={entry?.id}
													effectiveProvider={entry?.provider}
													onPick={(m) => {
														setPicked((prev) => ({ ...prev, [slot]: m }));
														// Auto-populate (chunk 2, owner: "populate
														// everywhere"): no explicit level → the
														// ordering's level for the fresh pick; an
														// explicit one rides (Save clamps server-side).
														setLevels((prev) => ({
															...prev,
															[slot]: populateLevel(prev[slot], m.supportedLevels),
														}));
														setOpenMenu(null);
													}}
													footer={catalog && catalog.length === 0 ? "No image-capable models. Sign in to a subscription with a vision model." : undefined}
												/>
											</MenuShell>
										</div>
										{/* Thinking selector (chunk 2): editable, pre-populated from
										    the ordering per picked model — no model, no levels.
										    None for the outside agent (it sets its own effort). */}
										{!providerHidesThinking(entry?.provider) && (
										<div className="relative">
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} thinking`}
												data-testid={`setup-thinking-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "thinking"}
												disabled={!entry}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "thinking" ? null : { slot, kind: "thinking" })}
												className="lh-press flex h-7 w-24 items-center gap-1 rounded-sm border border-border bg-background px-1.5 font-ui text-xs text-foreground hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40"
											>
												<span className="min-w-0 flex-1 truncate text-left">
													{entry ? (level ? THINKING_LABEL[level] ?? level : "…") : "—"}
												</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											<MenuShell
												open={open && openMenu?.slot === slot && openMenu.kind === "thinking"}
												anchorTestid={`setup-thinking-${slot}`}
												testid={`setup-thinking-menu-${slot}`}
												preferredSide="down"
												align="left"
												menuClass="flex w-44 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
											>
												<ThinkingMenuList
													levels={levelsForEntry.map(String)}
													effectiveLevel={level}
													onPick={(lv) => {
														setLevels((prev) => ({ ...prev, [slot]: lv as ThinkingLevel }));
														setOpenMenu(null);
													}}
												/>
											</MenuShell>
										</div>
										)}
									</div>
								</div>
							);
						})}
						<div className="flex items-center gap-3">
							<button
								type="button"
								data-testid="setup-save"
								disabled={!allPicked || saving}
								onClick={() => void save()}
								className="lh-press rounded-sm border border-border bg-background px-3 py-1.5 font-ui text-xs text-foreground hover:border-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{saving ? "Saving…" : "Save models"}
							</button>
							{error && <p className="text-xs text-red-400">{error}</p>}
						</div>
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}
