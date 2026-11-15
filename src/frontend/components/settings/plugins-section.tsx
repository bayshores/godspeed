/**
 * Settings → Plugins: the installed plugins in a list, the picked one's sheet beside it.
 * "+ Add" opens the folder chooser itself and installs from the folder.
 */

import { useCallback, useEffect, useState } from "react";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { changePlugin, fetchPlugins, installPlugin, removePlugin, type InstalledPlugin, type PluginResult } from "@/frontend/lib/plugins-api";
import { cn } from "@/frontend/lib/utils";
import { BrokenSheet, PluginSheet } from "./plugins-sheet.tsx";

const ROW = "lh-press flex items-center gap-2 px-3.5 py-3 text-left text-base text-ink";

export function PluginsSection() {
	const agentName = useAgentStatus()?.name;
	// undefined: loading. null: the server didn't answer.
	const [plugins, setPlugins] = useState<InstalledPlugin[] | null | undefined>(undefined);
	const [pick, setPick] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Where a failed action was: the Add key or the open sheet.
	const [problem, setProblem] = useState<{ at: "add" | "sheet"; text: string } | null>(null);

	const load = useCallback(() => fetchPlugins().then(setPlugins), []);
	useEffect(() => {
		void load();
	}, [load]);

	const run = async (at: "add" | "sheet", action: () => Promise<string | null>) => {
		setProblem(null);
		setBusy(true);
		const text = await action();
		setBusy(false);
		if (text) setProblem({ at, text });
	};
	const keep = (result: PluginResult) => {
		if (result.plugin) setPlugins((all) => all?.map((p) => (p.id === result.plugin.id ? result.plugin : p)));
		return result.error;
	};

	const remove = async (id: string) => {
		const text = await removePlugin(id);
		if (!text) setPlugins((all) => all?.filter((p) => p.id !== id));
		return text;
	};

	const pickFolder = typeof window !== "undefined" ? window.lh?.pickFolder : undefined;
	const add = () =>
		void run("add", async () => {
			const folder = await pickFolder?.();
			if (!folder) return null;
			const result = await installPlugin(folder);
			if (result.plugin) {
				setPick(result.plugin.id);
				await load();
			}
			return result.error;
		});

	if (!plugins) return <p className="text-xs text-ink-2">{plugins === null ? "Plugins could not be loaded." : "Loading…"}</p>;
	const picked = plugins.find((p) => p.id === pick) ?? plugins[0];
	return (
		<>
			<p className="text-lg text-ink-2">Plugins can't open your files.</p>
			<div className="flex items-start gap-6">
				<Pane aria-label="Plugins" data-testid="plugins-list" className="flex w-[260px] shrink-0 flex-col p-3">
					{plugins.map((p) => {
						const on = p === picked;
						const off = "manifest" in p && !p.enabled;
						return (
							<button
								key={p.id}
								type="button"
								data-testid={`plugin-${p.id}`}
								aria-current={on}
								onClick={() => {
									setProblem(null);
									setPick(p.id);
								}}
								className={cn(ROW, on ? "bg-highlight font-medium" : "hover:bg-tone")}
							>
								<span className="min-w-0 flex-1 truncate">{"manifest" in p ? p.manifest.name : p.id}</span>
								{/* Picked, the sheet's switch says it. */}
								{off && !on && <span className="shrink-0 text-ink-2">Off</span>}
							</button>
						);
					})}
					{plugins.length > 0 && <div className="h-4" aria-hidden />}
					{pickFolder && (
						<button type="button" data-testid="plugins-add" disabled={busy} onClick={add} className={cn(ROW, "hover:bg-tone")}>
							<PixelIcon name="plus" className="h-[9px]" />
							Add
						</button>
					)}
					{problem?.at === "add" && (
						<p role="alert" data-testid="plugins-add-error" className="px-3.5 pt-2 text-[15px] whitespace-pre-wrap text-ans-wrong">
							{problem.text}
						</p>
					)}
				</Pane>
				<div className="min-w-0 flex-1">
					{!picked ? (
						<Pane data-testid="plugins-empty" className="px-8 py-7">
							<p className="text-base text-ink-2">No plugins yet.</p>
						</Pane>
					) : "manifest" in picked ? (
						<PluginSheet
							key={picked.id}
							manifest={picked.manifest}
							enabled={picked.enabled}
							values={picked.values}
							folder={picked.folder}
							agentName={agentName}
							busy={busy}
							error={problem?.at === "sheet" ? problem.text : null}
							onChange={(change) => void run("sheet", async () => keep(await changePlugin(picked.id, change)))}
							onRemove={() => void run("sheet", () => remove(picked.id))}
						/>
					) : (
						<BrokenSheet key={picked.id} name={picked.id} reason={picked.error} busy={busy} error={problem?.at === "sheet" ? problem.text : null} onRemove={() => void run("sheet", () => remove(picked.id))} />
					)}
				</div>
			</div>
		</>
	);
}
