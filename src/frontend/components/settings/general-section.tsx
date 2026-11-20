/**
 * Settings → General: the teacher's name, sounds, deadline reminders, the Mac menu bar
 * countdown and updates.
 */

import { DEFAULT_TEACHER_NAME, resolveSettings, type UserSettings } from "@/shared/core";
import type { GeneralPatch } from "@/frontend/components/settings-context";
import { CommitInput, SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";
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
		// Wide, the groups sit side by side instead of as long rows.
		<div className="grid items-start gap-6 @[1000px]/page:grid-cols-2 @[1300px]/page:grid-cols-3">
			<SettingsGroup label="Teacher and sounds" testid="group-you">
				<SettingsRow label="Teacher name" testid="teacher-name-row">
					<CommitInput
						value={record.general?.teacherName ?? ""}
						placeholder={DEFAULT_TEACHER_NAME}
						ariaLabel="Teacher name"
						testid="teacher-name"
						onCommit={(next) => onGeneralChange({ teacherName: next || null })}
					/>
				</SettingsRow>
				<SettingsRow label="Startup sound" testid="startup-sound-row">
					<Toggle
						checked={effective.general.startupSound}
						label="Startup sound"
						onChange={(on) => onGeneralChange({ startupSound: on })}
					/>
				</SettingsRow>
				<SettingsRow label="Sounds" hint="Setup and right or wrong answers" testid="sounds-row">
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
			<SettingsGroup label="Updates" testid="group-updates">
				<UpdateSettings
					autoUpdate={effective.general.autoUpdate}
					onAutoUpdateChange={(on) => onGeneralChange({ autoUpdate: on })}
				/>
			</SettingsGroup>
		</div>
	);
}
