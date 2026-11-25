/**
 * Settings → General: sounds, deadline reminders, the Mac menu bar countdown, the notes folder and
 * updates. The teacher's name is in Settings → Teacher.
 */

import { resolveSettings, type UserSettings } from "@/shared/core";
import type { GeneralPatch } from "@/frontend/components/settings-context";
import { SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";
import { NotesFolderGroup } from "./notes-folder-group.tsx";
import { UpdateSettings } from "./update-settings.tsx";

export function GeneralSection({
	record,
	onGeneralChange,
}: {
	record: UserSettings;
	/** Only the fields that changed. */
	onGeneralChange: (fields: GeneralPatch) => void;
}) {
	// The same resolver the server uses, so the switches show what is in effect.
	const effective = resolveSettings(record);
	return (
		// Wide, the groups sit side by side instead of as long rows, each as tall as the tallest
		// beside it, so the gap under every card is the same.
		<div className="grid gap-6 @[1000px]/page:grid-cols-2 @[1300px]/page:grid-cols-3">
			<SettingsGroup label="Sounds" testid="group-sounds">
				<SettingsRow label="Startup sound" testid="startup-sound-row">
					<Toggle
						checked={effective.general.startupSound}
						label="Startup sound"
						onChange={(on) => onGeneralChange({ startupSound: on })}
					/>
				</SettingsRow>
				<SettingsRow label="Sounds" hint="Setup, right or wrong answers and Noise" testid="sounds-row">
					<Toggle checked={effective.general.sounds} label="Sounds" onChange={(on) => onGeneralChange({ sounds: on })} />
				</SettingsRow>
			</SettingsGroup>
			{/* Only the desktop shell shows notifications. */}
			{typeof window !== "undefined" && window.lh && (
				<SettingsGroup label="Reminders" testid="group-reminders">
					<SettingsRow label="Deadline reminders" hint="One notification a day when a deadline is 3 days away or less" testid="deadline-reminders-row">
						<Toggle
							checked={effective.general.deadlineReminders}
							label="Deadline reminders"
							onChange={(on) => onGeneralChange({ deadlineReminders: on })}
						/>
					</SettingsRow>
					{window.lh.platform === "darwin" && (
						<SettingsRow label="Menu bar countdown" testid="menu-bar-countdown-row">
							<Toggle
								checked={effective.general.menuBarCountdown}
								label="Menu bar countdown"
								onChange={(on) => onGeneralChange({ menuBarCountdown: on })}
							/>
						</SettingsRow>
					)}
				</SettingsGroup>
			)}
			<NotesFolderGroup />
			<SettingsGroup label="Updates" testid="group-updates">
				<UpdateSettings
					autoUpdate={effective.general.autoUpdate}
					onAutoUpdateChange={(on) => onGeneralChange({ autoUpdate: on })}
				/>
			</SettingsGroup>
		</div>
	);
}
