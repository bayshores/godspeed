/**
 * Settings → General: the teacher's name, sounds, deadline reminders and
 * updates.
 */

import { DEFAULT_TEACHER_NAME, resolveSettings, type GeneralSettings, type UserSettings } from "@/shared/core";
import { CommitInput, SettingsGroup, SettingsRow, Toggle } from "./controls.tsx";
import { UpdateSettings } from "./update-settings.tsx";

export function GeneralSection({
	record,
	onGeneralChange,
}: {
	record: UserSettings;
	onGeneralChange: (next: GeneralSettings) => void;
}) {
	// The same resolver the server uses, so the switches show what is in effect.
	const effective = resolveSettings(record);
	return (
		<>
			<SettingsGroup label="Teacher and sounds" testid="group-you">
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
			{/* Only the desktop shell shows notifications. */}
			{typeof window !== "undefined" && window.lh && (
				<SettingsGroup label="Reminders" testid="group-reminders">
					<SettingsRow label="Deadline reminders" hint="One notification a day when a deadline is 3 days away or less" testid="deadline-reminders-row">
						<Toggle
							checked={effective.general.deadlineReminders}
							label="Deadline reminders"
							onChange={(on) => onGeneralChange({ ...record.general, deadlineReminders: on })}
						/>
					</SettingsRow>
				</SettingsGroup>
			)}
			<SettingsGroup label="Updates" testid="group-updates">
				<UpdateSettings
					autoUpdate={effective.general.autoUpdate}
					onAutoUpdateChange={(on) => onGeneralChange({ ...record.general, autoUpdate: on })}
				/>
			</SettingsGroup>
		</>
	);
}
