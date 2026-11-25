/**
 * One agent's live screen and, under it, its footer (screen-footer.tsx).
 * The teacher's screen also takes dropped files for Attach. Onboarding's
 * first start shows it. A space file name in the screen opens the file (a
 * PDF in its own app, anything else shown in its folder), and a passage id
 * opens the source popup.
 */
import { useCallback, useEffect, useState } from "react";
import { CiteDialog } from "@/frontend/components/citations/cite-dialog";
import type { PassageCite } from "@/frontend/components/citations/page-excerpt-model";
import { showSpaceFile } from "@/frontend/components/files/show-space-file";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import type { ScreenLink } from "./terminal-links-model";
import { chatGone, type TerminalFooter } from "./terminal-model";
import { ScreenFooter } from "./screen-footer";
import { useSpaceFiles } from "./use-space-files";
import type { TerminalsApi } from "./use-terminals";


/** xterm loads with the first screen shown. */
const TerminalView = lazyComponent(() => import("./terminal-view").then((m) => m.TerminalView));

export function TerminalPane({ api, name, foot, focusOnOpen }: {
	api: TerminalsApi;
	/** The teacher's name. */
	name: string;
	foot: TerminalFooter;
	/** The learner opened it: the screen takes the keyboard. Opened by
	 *  itself, it waits for a click in the screen. */
	focusOnOpen: boolean;
}) {
	const term = api.teacher!;
	const [focusKey, setFocusKey] = useState(0);
	const [error, setError] = useState<string | null>(null);
	// A refusal shows until the screen asks something else or the footer changes.
	useEffect(() => setError(null), [term.id, term.prompt, foot.text, foot.assist?.kind, foot.startAgain]);
	const live = !term.ended;
	// Running: it reached godspeed. Asked: it waits for the learner (a question, a sign-in).
	const running = live && !!api.facts?.checkedIn;
	const asked = live && (!!term.prompt || !!term.url);
	const refocus = () => setFocusKey((n) => n + 1);
	const startAgain = async () => setError(await api.start(term.agent));
	// Each file's path goes in after the one before, then the screen takes the keys again.
	const attach = async (files: readonly File[]) => {
		for (const file of files) {
			const refused = await api.addFile(file);
			setError(refused);
			if (refused) break;
		}
		refocus();
	};
	const files = useSpaceFiles();
	const [cite, setCite] = useState<PassageCite | null>(null);
	const onLink = useCallback(({ file, passage }: ScreenLink) => {
		if (passage !== undefined) {
			setCite({ fileId: file.id, passage, name: file.name });
			return;
		}
		void showSpaceFile(file.spaceId, file.id).then((failed) => {
			if (failed) setError(failed);
		});
	}, []);

	return (
		<>
			<div
				className="relative flex min-h-0 min-w-0 flex-1 flex-col"
				onDragOver={(e) => running && e.dataTransfer.types.includes("Files") && e.preventDefault()}
				onDrop={(e) => {
					if (!running || e.dataTransfer.files.length === 0) return;
					e.preventDefault();
					void attach(Array.from(e.dataTransfer.files));
				}}
			>
				<TerminalView key={term.id} id={term.id} ended={!live} focusOnOpen={focusOnOpen} focusKey={focusKey} files={files} onLink={onLink} />
			</div>
			<ScreenFooter
				text={error ?? foot.text}
				onAttach={running ? (files) => void attach(files) : null}
				onPaste={
					running || asked
						? () => {
								void api.paste().then(setError);
								refocus();
							}
						: null
				}
				onStop={live ? () => void api.stop() : null}
				off={`Turn off ${name}`}
				get={foot.get}
				assist={
					foot.assist && {
						label: foot.assist.label,
						run: () => {
							void api.answer(foot.assist!.kind).then(setError);
							refocus();
						},
					}
				}
				onStartAgain={foot.startAgain ? () => void startAgain() : null}
				again={chatGone(term.ended) ? "New chat" : "Start again"}
			/>
			<CiteDialog
				cite={cite}
				onClose={() => {
					setCite(null);
					refocus();
				}}
			/>
		</>
	);
}
