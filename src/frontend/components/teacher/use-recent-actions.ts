/** The agent's recent changes, and what the strip's peek offers from them:
 *  "Go to" a change on another page, and an open the window held. */

import { useCallback, useEffect, useState } from "react";
import type { AgentAction } from "@/shared/core";
import { useServerResync } from "@/frontend/components/server-events";
import { getJson } from "@/frontend/lib/api";
import { GO_OFFER_MS, goOffer, heldStill } from "./follow";

const RECENT_LIMIT = 20;

export function useRecentActions(followOn: boolean, pathname: string) {
	const [recent, setRecent] = useState<AgentAction[]>([]);
	const loadRecent = useCallback(() => {
		void getJson<{ actions?: AgentAction[] }>("/api/agent-actions").then(({ body }) => {
			if (Array.isArray(body?.actions)) setRecent(body.actions.slice(0, RECENT_LIMIT));
		});
	}, []);
	useEffect(loadRecent, [loadRecent]);
	useServerResync(loadRecent);
	const add = useCallback((action: AgentAction) => setRecent((list) => [action, ...list.filter((a) => a.id !== action.id)].slice(0, RECENT_LIMIT)), []);

	// "Go to": with Follow off, the newest change on another page.
	const [offer, setOffer] = useState<AgentAction | null>(null);
	useEffect(() => {
		const next = goOffer(recent, { follow: followOn, path: pathname, now: Date.now() });
		setOffer(next);
		if (!next) return;
		const t = setTimeout(() => setOffer(null), GO_OFFER_MS - (Date.now() - Date.parse(next.at)));
		return () => clearTimeout(t);
	}, [recent, followOn, pathname]);

	// A held open: what the agent opened while the window held, until it is
	// reached, replaced or stale.
	const [held, setHeld] = useState<AgentAction | null>(null);
	useEffect(() => {
		if (!held) return;
		if (!heldStill(held, { path: pathname, now: Date.now() })) return setHeld(null);
		const t = setTimeout(() => setHeld(null), GO_OFFER_MS - (Date.now() - Date.parse(held.at)));
		return () => clearTimeout(t);
	}, [held, pathname]);

	return { recent, add, offer, held, setHeld };
}
