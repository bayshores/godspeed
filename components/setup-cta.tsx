"use client";
/**
 * The no-connection surfaces (subscriptions only — API keys were
 * removed): when NO subscription is signed in, chat / home / /chat/new
 * hoist a composer pill — "Sign in to a subscription" — that takes
 * PRECEDENCE over the models setup CTA (a connection comes first in the
 * chain: the model pickers list only what a connection unlocks). Click
 * opens the SetupDialog, whose stage derives to the connect screen on its
 * own.
 *
 * Truth: GET /api/models' providers[] (one row per subscription, with its
 * connected flag). Live updates ride the lh:settings-saved "providers"
 * signal (the subscription controls dispatch it on every connection
 * change), the same re-read pattern chat.tsx uses for "models".
 */

import { useModelCatalog } from "@/components/model-picker";
import type { ModelCatalogResponse } from "@/src/core";

/** The no-connection truth for the calling page: TRUE only after a
 *  successful read says no subscription is connected (pending and failed
 *  reads render nothing — the pill must never flash on a gap, and a
 *  failed read claiming "nothing connected" would be a lie the CTA flow
 *  then leans on). Re-reads on the providers signal. */
export function useNoConnection(): boolean {
	const { catalog } = useModelCatalog();
	return catalog ? !catalog.providers.some((provider) => provider.connected) : false;
}

/** The pill itself — the models CTA's chrome and placement, the
 *  connection chain's copy. testid "setup-cta-connect" (the models CTA
 *  keeps "setup-cta"; probes can tell them apart). */
export function ConnectPill({ onOpen, inline = false }: { onOpen: () => void; inline?: boolean }) {
	const button = (
		<button
			type="button"
			data-testid="setup-cta-connect"
			onClick={onOpen}
			className="lh-press lh-fade rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
		>
			Sign in to a subscription
		</button>
	);
	return inline ? button : <div className="pointer-events-auto mb-2 flex justify-center">{button}</div>;
}

/** Pure: the strong slot is pinned to a provider that is NOT connected
 *  (signed out, or a legacy pin to a removed API-key provider). The
 *  catalog already knows both halves: slots.strong is the resolved pin,
 *  providers[] carries each subscription's connected flag. False when the
 *  strong slot is unset (the models guard owns that case — this check
 *  only runs when slots ARE configured) or the catalog hasn't loaded (the
 *  server gate remains the belt). Exported for pins. */
export function strongDisconnected(catalog: ModelCatalogResponse | undefined): boolean {
	const strong = catalog?.slots.strong;
	if (!strong) return false;
	return !catalog.providers.some((p) => p.id === strong.model.provider && p.connected);
}

/** The strong-slot disconnected truth for the PRE-SEND guard (home /
 *  /chat/new): the catalog seam with re-reads on BOTH signals that can
 *  flip it — "providers" (a subscription signed in or out) and "models"
 *  (the strong slot re-pinned). Live-updates with the page, never
 *  mid-send. */
export function useStrongDisconnected(): boolean {
	const { catalog } = useModelCatalog();
	return strongDisconnected(catalog);
}
