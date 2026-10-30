/**
 * Settings → General: the
 * teacher's name, sounds, when long lessons get summarized, how the graph
 * grows, and updates.
 */

import {
	COMPACTION_THRESHOLD_FLOOR,
	DEFAULT_TEACHER_NAME,
	EXTRACTION_CHUNK_TOKENS_FLOOR,
	resolveSettings,
	type CompactionSettings,
	type GeneralSettings,
	type GraphSettings,
	type UserSettings,
} from "@/core";
import { CommitInput, SettingsGroup, SettingsRow, Slider, Toggle } from "./controls.tsx";
import { UpdateSettings } from "./update-settings.tsx";

/** 150000 → "150k tokens", 4096 → "4.1k tokens". */
function tokensLabel(tokens: number): string {
	return `${Math.round(tokens / 100) / 10}k tokens`;
}

export function GeneralSection({
	record,
	onGeneralChange,
	onCompactionChange,
	onGraphChange,
}: {
	record: UserSettings;
	onGeneralChange: (next: GeneralSettings) => void;
	onCompactionChange: (next: CompactionSettings) => void;
	onGraphChange: (next: GraphSettings) => void;
}) {
	// The same resolver the server uses, so the sliders show the numbers in effect.
	const effective = resolveSettings(record);
	const graph = record.graph;
	return (
		<>
			<SettingsGroup label="You" testid="group-you">
				<SettingsRow label="Teacher name" hint="Shown in the window only" testid="teacher-name-row">
					<CommitInput
						value={record.general?.teacherName ?? ""}
						placeholder={DEFAULT_TEACHER_NAME}
						ariaLabel="Teacher name"
						testid="teacher-name"
						onCommit={(next) => {
							const { teacherName: _old, ...rest } = record.general ?? {};
							onGeneralChange(next ? { ...rest, teacherName: next } : rest);
						}}
					/>
				</SettingsRow>
				<SettingsRow label="Sounds" hint="Startup, setup and right or wrong answers" testid="sounds-row">
					<Toggle checked={effective.general.sounds} label="Sounds" onChange={(on) => onGeneralChange({ ...record.general, sounds: on })} />
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup label="Lessons" testid="group-lessons">
				<SettingsRow label="Summarize long lessons after" hint="Older parts of a long lesson get summarized so it keeps fitting" testid="row-compaction">
					<span className="w-[300px] shrink-0">
						<Slider
							value={effective.compaction.thresholdTokens}
							min={COMPACTION_THRESHOLD_FLOOR}
							max={200_000}
							step={2_000}
							ariaLabel="Summarize long lessons after"
							testid="slider-compaction"
							label={tokensLabel}
							onCommit={(v) => onCompactionChange({ ...record.compaction, thresholdTokens: v })}
						/>
					</span>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup label="Graph" testid="section-graph">
				<SettingsRow label="Build the graph from lessons" hint="Off: the graph stops growing" testid="graph-row-enabled">
					<Toggle checked={effective.graph.enabled} label="build the graph" onChange={(on) => onGraphChange({ ...graph, enabled: on })} />
				</SettingsRow>
				<SettingsRow
					label="Add to the graph every"
					hint="Smaller means more often, and more agent work"
					testid="graph-row-chunk-tokens"
					dimmed={!effective.graph.enabled}
				>
					<span className="w-[300px] shrink-0">
						<Slider
							value={effective.graph.extractionChunkTokens}
							min={EXTRACTION_CHUNK_TOKENS_FLOOR}
							max={16_000}
							step={500}
							disabled={!effective.graph.enabled}
							ariaLabel="Add to the graph every"
							testid="slider-chunk-tokens"
							label={tokensLabel}
							onCommit={(v) => onGraphChange({ ...graph, extractionChunkTokens: v })}
						/>
					</span>
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup label="Updates" testid="group-updates">
				<UpdateSettings
					autoUpdate={effective.general.autoUpdate}
					onAutoUpdateChange={(on) => onGeneralChange({ ...record.general, autoUpdate: on })}
				/>
			</SettingsGroup>
		</>
	);
}
