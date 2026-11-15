/**
 * One agent's live screen and, under it, the sentence about what is
 * happening with its buttons: Attach (the teacher's screen only, which
 * also takes dropped files), Paste and Stop stay quiet, and the assist
 * key or Start again is the one bright key. The teacher's panel and
 * onboarding's first start show it. A space file name in the screen opens
 * the file (a PDF in its own app, anything else shown in its folder), and
 * a passage id opens the source popup.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ATTACHMENT_ACCEPT } from "@/shared/core";
import { CiteDialog } from "@/frontend/components/citations/cite-dialog";
import type { PassageCite } from "@/frontend/components/citations/page-excerpt-model";
import { spaceFilePathOf } from "@/frontend/components/files/space-files-api";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import type { ScreenLink } from "./terminal-links-model";
import type { TerminalFooter, TerminalRole } from "./terminal-model";
import { useSpaceFiles } from "./use-space-files";
import type { TerminalsApi } from "./use-terminals";

const FILE_GONE = "Can't find this file on your computer.";

/** xterm loads with the first screen shown. */
const TerminalView = lazyComponent(() => import("./terminal-view").then((m) => m.TerminalView));

export function TerminalPane({ api, role, foot, focusOnOpen }: {
	api: TerminalsApi;
	role: TerminalRole;
	foot: TerminalFooter;
	/** The learner opened it: the screen takes the keyboard. Opened by
	 *  itself, it waits for a click in the screen. */
	focusOnOpen: boolean;
}) {
	const term = api[role]!;
	const [focusKey, setFocusKey] = useState(0);
	const [error, setError] = useState<string | null>(null);
	// A refusal shows until what the footer says changes.
	useEffect(() => setError(null), [term.id, foot.text]);
	const live = !term.ended;
	const refocus = () => setFocusKey((n) => n + 1);
	const startAgain = async () => setError(await api.start(role, term.agent));
	const attaches = role === "teacher" && live;
	const picker = useRef<HTMLInputElement>(null);
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
		void spaceFilePathOf(file.spaceId, file.id).then((path) => {
			if (!path) setError(FILE_GONE);
			else void (/\.pdf$/i.test(path) ? window.lh?.openPath?.(path) : window.lh?.showInFolder?.(path));
		});
	}, []);

	return (
		<>
			<div
				className="flex min-h-0 min-w-0 flex-1 flex-col"
				onDragOver={(e) => attaches && e.dataTransfer.types.includes("Files") && e.preventDefault()}
				onDrop={(e) => {
					if (!attaches || e.dataTransfer.files.length === 0) return;
					e.preventDefault();
					void attach(Array.from(e.dataTransfer.files));
				}}
			>
				<TerminalView key={term.id} id={term.id} ended={!live} focusOnOpen={focusOnOpen} focusKey={focusKey} files={files} onLink={onLink} />
			</div>
			{/* In a narrow window the buttons move under the sentence. */}
			<div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-border py-3.5 pr-3.5 pl-6">
				<p data-testid="terminal-footer" role="status" className="min-w-64 flex-1 text-lg text-ink">
					{error ?? foot.text}
				</p>
				<div className="ml-auto flex shrink-0 items-center gap-2.5">
					{attaches && (
						<>
							<input
								ref={picker}
								type="file"
								multiple
								hidden
								accept={ATTACHMENT_ACCEPT}
								data-testid="terminal-attach-input"
								onChange={(e) => {
									void attach(Array.from(e.target.files ?? []));
									e.target.value = "";
								}}
							/>
							<button type="button" data-testid="terminal-attach" onClick={() => picker.current?.click()} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
								Attach
							</button>
						</>
					)}
					{live && (
						<>
							<button
								type="button"
								data-testid="terminal-paste"
								onClick={() => {
									void api.paste(role).then(setError);
									refocus();
								}}
								className="lh-btn lh-btn-quiet shrink-0 text-[15px]"
							>
								Paste
							</button>
							<button type="button" data-testid="terminal-stop" onClick={() => api.stop(role)} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
								Stop
							</button>
						</>
					)}
					{foot.get && (
						<button type="button" data-testid="terminal-get" onClick={() => void window.lh?.openLink?.(foot.get!.url)} className="lh-btn shrink-0 text-[15px]">
							{foot.get.label}
						</button>
					)}
					{foot.assist && (
						<button
							type="button"
							data-testid="terminal-assist"
							onClick={() => {
								void api.answer(role, foot.assist!.kind).then(setError);
								refocus();
							}}
							className="lh-btn lh-btn-main shrink-0 text-[15px]"
						>
							{foot.assist.label}
						</button>
					)}
					{foot.startAgain && (
						<button type="button" data-testid="terminal-start-again" onClick={() => void startAgain()} className="lh-btn lh-btn-main shrink-0 text-[15px]">
							Start again
						</button>
					)}
				</div>
			</div>
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
