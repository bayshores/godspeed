import { useEffect, useState } from "react";
import { effectiveThresholdTokens, OUTSIDE_AGENT_CONTEXT_WINDOW, resolveSettings, type UserSettings } from "@/core";
import { useSettingsSaved } from "@/components/settings-signal";

/** The lesson size where the lesson gets summarized (the user's setting,
 *  capped by the agent budget). Null until the settings load. */
export function useSummarizePoint(): number | null {
	const [point, setPoint] = useState<number | null>(null);
	const [version, setVersion] = useState(0);
	useSettingsSaved((section) => {
		if (section === "compaction") setVersion((v) => v + 1);
	});
	useEffect(() => {
		let live = true;
		fetch("/api/settings", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { settings?: UserSettings | null } | null) => {
				if (!live || !body) return;
				const setting = resolveSettings(body.settings ?? null).compaction.thresholdTokens;
				setPoint(effectiveThresholdTokens(setting, OUTSIDE_AGENT_CONTEXT_WINDOW));
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [version]);
	return point;
}
