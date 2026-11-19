import { useEffect, useMemo, useRef } from "react";
import { parseSavedRules, type SavedRule } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** The rules an agent saved, for the "Saved by" labels. Reloads when a
 *  rule changes, and when `rules` (the list on screen) changes, since the
 *  server drops the marks of rules the learner removed. */
export function useSavedRules(rules: unknown): SavedRule[] {
	const { value, reload } = useServerResource<unknown>("/api/rules", { on: { "rules-changed": true } });
	// The mount read is the shared hook's own.
	const mounted = useRef(false);
	useEffect(() => {
		if (mounted.current) void reload();
		mounted.current = true;
	}, [rules, reload]);
	return useMemo(() => parseSavedRules(value), [value]);
}
