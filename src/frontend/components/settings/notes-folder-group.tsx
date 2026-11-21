/**
 * Settings, General: the folder godspeed writes notes in, and who writes them. Obsidian's vaults
 * are keys, any other folder comes from the folder picker (a path field in a plain browser).
 */

import { useState } from "react";
import { LinkFolderField } from "@/frontend/components/files/linked-folder";
import { fileBrowserName } from "@/frontend/components/files/files-model";
import { useSettings } from "@/frontend/components/settings-context";
import { Segmented } from "@/frontend/components/ui/segmented";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { canOpenNote, openNote } from "@/frontend/components/vault/open-note";
import { useVault } from "@/frontend/components/vault/vault-context";
import { folderLine, folderTitle, pickLine, vaultHead, VAULT_WORDS, type VaultFolder, type VaultStatus, type VaultWords } from "@/frontend/components/vault/vault-model";
import { cn } from "@/frontend/lib/utils";
import { QUIET_KEY, SettingsGroup, SMALL_KEY } from "./controls.tsx";

export function NotesFolderGroup() {
	const { status, error: readError } = useVault();
	if (!status) {
		return readError ? (
			<SettingsGroup label="Notes folder" testid="group-vault">
				<p role="alert" className="text-ans-wrong">
					The notes folder could not be read.
				</p>
			</SettingsGroup>
		) : null;
	}
	return (
		<SettingsGroup label={vaultHead(status)} testid="group-vault">
			<FolderBlock status={status} />
			<WhoWrites words={status.words} />
		</SettingsGroup>
	);
}

function FolderBlock({ status }: { status: VaultStatus }) {
	const { change, retry } = useVault();
	const { busy, error, run } = useGuardedAction();
	const [typing, setTyping] = useState(false);
	const { folder } = status;
	const problem = status.state === "missing" || status.state === "failed";

	const link = (path: string) =>
		void run(async () => {
			const failed = await change({ path });
			if (failed === null) setTyping(false);
			return failed;
		});
	const choose = () => {
		const pick = typeof window === "undefined" ? undefined : window.lh?.pickFolder;
		if (!pick) {
			setTyping(true);
			return;
		}
		void run(async () => {
			const picked = await pick();
			return picked ? change({ path: picked }) : null;
		});
	};

	return (
		<div data-testid="vault-folder" data-state={status.state} className="flex flex-col gap-2.5 py-3.5">
			{folder ? (
				<>
					<div className="flex flex-col gap-1">
						<span data-testid="vault-title" className="text-[17px] leading-snug break-words text-ink">
							{folderTitle(folder, status.obsidian)}
						</span>
						<p data-testid="vault-line" className={cn("text-[15px]", problem ? "text-ans-wrong" : "text-ink-2")}>
							{folderLine(status, fileBrowserName(typeof window === "undefined" ? undefined : window.lh?.platform))}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{problem ? (
							<>
								<button type="button" data-testid="vault-retry" disabled={busy} onClick={() => void run(retry)} className={SMALL_KEY}>
									Try again
								</button>
								<button type="button" data-testid="vault-pick-again" disabled={busy} onClick={choose} className={SMALL_KEY}>
									Pick folder again
								</button>
							</>
						) : (
							canOpenNote(status.obsidian) && (
								<button type="button" data-testid="vault-open" onClick={() => openNote(folder.path, status.obsidian)} className={QUIET_KEY}>
									{status.obsidian ? "Open in Obsidian" : `Show in ${fileBrowserName(window.lh?.platform)}`}
								</button>
							)
						)}
						<span className="flex-1" />
						<button type="button" data-testid="vault-unlink" disabled={busy} onClick={() => void run(() => change({ path: null }))} className={cn(QUIET_KEY, "text-ans-wrong hover:text-ans-wrong-hover")}>
							Unlink
						</button>
					</div>
				</>
			) : (
				<>
					<p className="text-[15px] text-ink-2">{pickLine(status)}</p>
					<div className="flex flex-wrap items-center gap-2">
						{status.vaults.map((vault) => (
							<VaultKey key={vault.path} vault={vault} disabled={busy} onPick={link} />
						))}
						<button type="button" data-testid="vault-other" disabled={busy} onClick={choose} className={SMALL_KEY}>
							Other folder…
						</button>
					</div>
				</>
			)}
			{typing && <LinkFolderField initial={folder?.path ?? ""} disabled={busy} onLink={link} onCancel={() => setTyping(false)} />}
			{error && (
				<p role="alert" data-testid="vault-error" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}

function VaultKey({ vault, disabled, onPick }: { vault: VaultFolder; disabled: boolean; onPick: (path: string) => void }) {
	return (
		<button type="button" data-testid="vault-pick" disabled={disabled} title={vault.short} onClick={() => onPick(vault.path)} className={SMALL_KEY}>
			{vault.name}
		</button>
	);
}

function WhoWrites({ words }: { words: VaultWords }) {
	const { change } = useVault();
	const { teacherName } = useSettings();
	const { busy, error, run } = useGuardedAction();
	const label: Record<VaultWords, string> = { teacher: `${teacherName} writes it`, mine: "I add my own words" };
	return (
		<div data-testid="vault-who" className="flex flex-col gap-3 pt-2.5 pb-3.5">
			<span className="text-[17px] leading-snug text-ink">Who writes the note</span>
			<Segmented
				label="Who writes the note"
				testid="vault-words"
				options={VAULT_WORDS.map((value) => ({ value, label: label[value] }))}
				value={words}
				disabled={busy}
				onChange={(next) => void run(() => change({ words: next }))}
			/>
			{error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}
