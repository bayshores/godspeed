/**
 * Settings → Plugins: the installed plugins in a list, the picked one's sheet beside it.
 * "+ Add" shows the Add sheet when godspeed's list has plugins to add; otherwise it opens the
 * folder chooser itself and installs from the folder.
 */

import { useCallback, useEffect, useState } from "react";
import { LoadingLine } from "@/frontend/components/loading";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { changePlugin, fetchListed, fetchPlugins, installListed, installPlugin, removePlugin, type InstalledPlugin, type ListedPlugin, type PluginResult } from "@/frontend/lib/plugins-api";
import { cn } from "@/frontend/lib/utils";
import { addAction, addable, updateFor } from "./plugins-model.ts";
import { AddSheet, BrokenSheet, PluginSheet } from "./plugins-sheet.tsx";

const ROW = "lh-press flex items-center gap-2 px-3.5 py-3 text-left text-ui text-ink";

/** Where an action runs and where its failure shows: Add (the folder chooser), the open sheet,
 *  its Update key, or a row of the Add sheet. */
type Place = "add" | "sheet" | "update" | `listed:${string}`;

export function PluginsSection() {
	const agentName = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	// undefined: loading. null: the server didn't answer.
	const [plugins, setPlugins] = useState<InstalledPlugin[] | null | undefined>(undefined);
	const [listed, setListed] = useState<ListedPlugin[]>([]);
	const [pick, setPick] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [running, setRunning] = useState<Place | null>(null);
	const [problem, setProblem] = useState<{ at: Place; text: string } | null>(null);

	const load = useCallback(() => fetchPlugins().then(setPlugins), []);
	// Both first, so a sheet shows once with its Update key, not before it.
	useEffect(() => {
		void Promise.all([fetchPlugins(), fetchListed()]).then(([installed, list]) => {
			setListed(list);
			setPlugins(installed);
		});
	}, []);

	const run = async (at: Place, action: () => Promise<string | null>) => {
		setProblem(null);
		setRunning(at);
		const text = await action();
		setRunning(null);
		if (text) setProblem({ at, text });
	};
	const keep = (result: PluginResult) => {
		if (result.plugin) setPlugins((all) => all?.map((p) => (p.id === result.plugin.id ? result.plugin : p)));
		return result.error;
	};
	/** A new plugin is picked, so its sheet shows. */
	const added = async (result: PluginResult) => {
		if (!result.plugin) return result.error;
		setShowAdd(false);
		setPick(result.plugin.id);
		await load();
		return null;
	};

	const remove = async (id: string) => {
		const text = await removePlugin(id);
		if (!text) setPlugins((all) => all?.filter((p) => p.id !== id));
		return text;
	};

	const pickFolder = typeof window !== "undefined" ? window.lh?.pickFolder : undefined;
	const chooseFolder = () =>
		void run("add", async () => {
			const folder = await pickFolder?.();
			return folder ? added(await installPlugin(folder)) : null;
		});

	if (!plugins) return plugins === null ? <p className="text-ui text-ink-2">Plugins could not be loaded.</p> : <LoadingLine className="text-ui" />;
	const rows = addable(listed, plugins);
	const addDoes = addAction(rows.length, !!pickFolder);
	const sheetOpen = showAdd && rows.length > 0;
	const picked = plugins.find((p) => p.id === pick) ?? plugins[0];
	const update = picked ? updateFor(picked, listed) : null;
	const busy = running !== null;
	return (
		<>
			<div className="flex flex-col gap-(--lh-gap) @[760px]/page:flex-row @[760px]/page:items-start">
				<Pane aria-label="Plugins" data-testid="plugins-list" className="flex shrink-0 flex-col p-2 @[760px]/page:w-[260px]">
					{plugins.map((p) => {
						const on = !sheetOpen && p === picked;
						const off = "manifest" in p && !p.enabled;
						return (
							<button
								key={p.id}
								type="button"
								data-testid={`plugin-${p.id}`}
								aria-current={on}
								onClick={() => {
									setProblem(null);
									setShowAdd(false);
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
					{addDoes && (
						<button
							type="button"
							data-testid="plugins-add"
							data-opens={addDoes}
							aria-current={sheetOpen}
							disabled={busy}
							onClick={() => {
								setProblem(null);
								if (addDoes === "sheet") setShowAdd(true);
								else chooseFolder();
							}}
							className={cn(ROW, sheetOpen ? "bg-highlight font-medium" : "hover:bg-tone")}
						>
							<PixelIcon name="plus" size={10} />
							Add
						</button>
					)}
					{!sheetOpen && problem?.at === "add" && (
						<p role="alert" data-testid="plugins-add-error" className="px-3.5 pt-2 text-ui whitespace-pre-wrap text-ans-wrong">
							{problem.text}
						</p>
					)}
				</Pane>
				<div className="min-w-0 flex-1">
					{sheetOpen ? (
						<AddSheet
							rows={rows}
							agentName={agentName}
							busy={busy}
							adding={running?.startsWith("listed:") ? running.slice(7) : null}
							failed={problem?.at.startsWith("listed:") ? problem.at.slice(7) : null}
							folderError={problem?.at === "add" ? problem.text : null}
							onAdd={(entry) => void run(`listed:${entry.id}`, async () => ((await added(await installListed(entry.id))) === null ? null : `${entry.name} couldn't be added.`))}
							onChoose={pickFolder && chooseFolder}
						/>
					) : !picked ? (
						<Pane data-testid="plugins-empty" className="lh-card">
							<p className="text-ui text-ink-2">No plugins yet.</p>
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
							updating={running === "update"}
							error={problem?.at === "sheet" || problem?.at === "update" ? problem.text : null}
							onChange={(change) => void run("sheet", async () => keep(await changePlugin(picked.id, change)))}
							onUpdate={update ? () => void run("update", async () => (keep(await installListed(picked.id)) === null ? null : `${picked.manifest.name} couldn't be updated.`)) : undefined}
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
