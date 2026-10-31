"use client";

import { useCallback, useEffect, useState } from "react";
import { parseSavedRules, type SavedRule } from "@/core";
import { useServerEvent } from "@/components/server-events";

/** The rules an agent saved, for the "Saved by" labels. Reloads when a
 *  rule changes, and when `rules` (the list on screen) changes, since the
 *  server drops the marks of rules the learner removed. */
export function useSavedRules(rules: unknown): SavedRule[] {
	const [saved, setSaved] = useState<SavedRule[]>([]);
	const load = useCallback(() => {
		fetch("/api/rules", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: unknown) => setSaved(parseSavedRules(body)))
			.catch(() => {});
	}, []);
	useEffect(load, [load, rules]);
	useServerEvent("rules-changed", load);
	return saved;
}
