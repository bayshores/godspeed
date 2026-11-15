import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Segmented } from "@/frontend/components/ui/segmented";
import { SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import type { ListedPlugin, PluginManifest, PluginSetting, SettingValue } from "@/frontend/lib/plugins-api";
import { cn } from "@/frontend/lib/utils";
import { CommitInput, QUIET_KEY, SMALL_KEY, SettingsRow, Toggle } from "./controls.tsx";
import { SEGMENTED_MAX, pluginLine } from "./plugins-model.ts";

/** The control godspeed draws for one setting the manifest declares. */
function SettingControl({ setting, value, onChange }: { setting: PluginSetting; value: SettingValue; onChange: (next: SettingValue) => void }) {
	const testid = `plugin-setting-${setting.key}`;
	if (setting.kind === "toggle") return <Toggle checked={value === true} label={setting.label} onChange={onChange} />;
	if (setting.kind === "choice" && setting.options.length <= SEGMENTED_MAX)
		return <Segmented label={setting.label} testid={testid} options={setting.options.map((o) => ({ value: o, label: o }))} value={String(value)} disabled={false} onChange={onChange} />;
	if (setting.kind === "choice")
		return (
			<span className="relative w-[200px] shrink-0">
				<select data-testid={testid} aria-label={setting.label} value={String(value)} onChange={(e) => onChange(e.target.value)} className={SELECT}>
					{setting.options.map((o) => (
						<option key={o} value={o}>
							{o}
						</option>
					))}
				</select>
				<PixelIcon name="chevron" className={SELECT_ARROW} />
			</span>
		);
	// A number that isn't one is dropped, so the field shows the stored value again.
	const commit = (next: string) => {
		if (setting.kind === "text") onChange(next);
		else if (next !== "" && Number.isFinite(Number(next))) onChange(Number(next));
	};
	return <CommitInput value={String(value)} ariaLabel={setting.label} testid={testid} onCommit={commit} />;
}

/** A failed save or removal, where the action was. */
function ErrorLine({ text }: { text: string }) {
	return (
		<p role="alert" data-testid="plugin-error" className="pt-3 text-[15px] whitespace-pre-wrap text-ans-wrong">
			{text}
		</p>
	);
}

function RemoveKey({ busy, onRemove }: { busy: boolean; onRemove: () => void }) {
	return (
		<button type="button" data-testid="plugin-remove" disabled={busy} onClick={onRemove} className={SMALL_KEY}>
			Remove
		</button>
	);
}

/** One plugin's sheet: its switch beside its name, what it adds and uses, its settings, then who
 *  made it. `onUpdate` is there when the list names a newer tag. */
export function PluginSheet({
	manifest,
	enabled,
	values,
	folder,
	agentName,
	busy,
	updating,
	error,
	onChange,
	onUpdate,
	onRemove,
}: {
	manifest: PluginManifest;
	enabled: boolean;
	values: Record<string, SettingValue>;
	folder: string;
	agentName?: string;
	busy: boolean;
	updating: boolean;
	error: string | null;
	onChange: (change: { enabled?: boolean; values?: Record<string, SettingValue> }) => void;
	onUpdate?: () => void;
	onRemove: () => void;
}) {
	const openPath = typeof window !== "undefined" ? window.lh?.openPath : undefined;
	return (
		<Pane data-testid="plugin-sheet" className="px-8 pt-7 pb-5">
			<div className="flex items-start justify-between gap-6">
				<div className="min-w-0">
					<h2 className="text-[26px] leading-tight text-ink">{manifest.name}</h2>
					<p className="pt-1.5 text-base text-ink-2">{pluginLine(manifest, agentName)}</p>
				</div>
				<span className="pt-1.5">
					<Toggle checked={enabled} label={manifest.name} onChange={(on) => onChange({ enabled: on })} />
				</span>
			</div>
			<div className="flex flex-col pt-4">
				{manifest.settings.map((s) => (
					// Off: its settings dim and lock, like every dependent settings row.
					<div key={s.key} inert={!enabled} className={cn(!enabled && "opacity-45")}>
						<SettingsRow label={s.label} testid={`plugin-row-${s.key}`}>
							<SettingControl setting={s} value={values[s.key] ?? s.default} onChange={(next) => onChange({ values: { [s.key]: next } })} />
						</SettingsRow>
					</div>
				))}
				{error && <ErrorLine text={error} />}
				<div className="flex items-center justify-between gap-6 pt-8 pb-2">
					<span className="text-[15px] text-ink-2">
						{manifest.version} by {manifest.author}
					</span>
					<span className="flex shrink-0 items-center gap-2">
						{openPath && (
							<button type="button" data-testid="plugin-show-folder" onClick={() => void openPath(folder)} className={QUIET_KEY}>
								<PixelIcon name="folder" />
								Show folder
							</button>
						)}
						{onUpdate && (
							<button type="button" data-testid="plugin-update" disabled={busy} onClick={onUpdate} className={SMALL_KEY}>
								{updating ? "Updating…" : "Update"}
							</button>
						)}
						<RemoveKey busy={busy} onRemove={onRemove} />
					</span>
				</div>
			</div>
		</Pane>
	);
}

/** What Add shows when the list has plugins to add: each with its Add key, then the folder
 *  chooser (desktop app only). A failed add says so under its row. */
export function AddSheet({
	rows,
	agentName,
	busy,
	adding,
	failed,
	folderError,
	onAdd,
	onChoose,
}: {
	rows: ListedPlugin[];
	agentName?: string;
	busy: boolean;
	/** The entry whose add runs. */
	adding: string | null;
	/** The entry whose add failed. */
	failed: string | null;
	folderError: string | null;
	onAdd: (entry: ListedPlugin) => void;
	onChoose?: () => void;
}) {
	return (
		<Pane data-testid="plugins-add-sheet" aria-label="Add" className="px-8 pt-7 pb-5">
			<p className="text-lg text-ink">Checked by godspeed.</p>
			<div className="flex flex-col pt-4">
				{rows.map((entry) => (
					<div key={entry.id}>
						<SettingsRow label={entry.name} hint={pluginLine(entry, agentName)} testid={`plugins-listed-${entry.id}`}>
							<button type="button" data-testid={`plugins-listed-add-${entry.id}`} disabled={busy} onClick={() => onAdd(entry)} className={SMALL_KEY}>
								{adding === entry.id ? "Adding…" : "Add"}
							</button>
						</SettingsRow>
						{failed === entry.id && <ErrorLine text={`${entry.name} couldn't be added.`} />}
					</div>
				))}
				{onChoose && (
					<SettingsRow label="From a folder" testid="plugins-from-folder">
						<button type="button" data-testid="plugins-choose-folder" disabled={busy} onClick={onChoose} className={SMALL_KEY}>
							Choose
						</button>
					</SettingsRow>
				)}
				{folderError && <ErrorLine text={folderError} />}
			</div>
		</Pane>
	);
}

/** A plugin whose manifest failed to load: why, and Remove. */
export function BrokenSheet({ name, reason, busy, error, onRemove }: { name: string; reason: string; busy: boolean; error: string | null; onRemove: () => void }) {
	return (
		<Pane data-testid="plugin-sheet" className="px-8 pt-7 pb-5">
			<h2 className="text-[26px] leading-tight text-ink">{name}</h2>
			<p data-testid="plugin-broken" className="pt-1.5 text-base whitespace-pre-wrap text-ans-wrong">
				{reason}
			</p>
			{error && <ErrorLine text={error} />}
			<div className="flex justify-end pt-8 pb-2">
				<RemoveKey busy={busy} onRemove={onRemove} />
			</div>
		</Pane>
	);
}
