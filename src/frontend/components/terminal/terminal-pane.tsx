/**
 * One agent's live screen and, under it, its footer (screen-footer.tsx).
 * The teacher's screen also takes dropped files for Attach, and in the
 * panel shows what the teacher can be asked: starter keys above its footer
 * while its chat is unused, an Ideas key in the footer after that, and the
 * whole list over the screen's foot. The
 * teacher's panel and onboarding's first start show it. A space file name
 * in the screen opens the file (a PDF in its own app, anything else shown
 * in its folder), and a passage id opens the source popup.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CiteDialog } from "@/frontend/components/citations/cite-dialog";
import type { PassageCite } from "@/frontend/components/citations/page-excerpt-model";
import { spaceFilePathOf } from "@/frontend/components/files/space-files-api";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import type { ScreenLink } from "./terminal-links-model";
import { chatGone, type TerminalFooter, type TerminalRole } from "./terminal-model";
import { IdeaList } from "./idea-list";
import { ScreenFooter } from "./screen-footer";
import { takesLine, type IdeaGroup } from "./starter-model";
import { StarterKeys } from "./starter-keys";
import { useSpaceFiles } from "./use-space-files";
import type { TerminalsApi } from "./use-terminals";

const FILE_GONE = "Can't find this file on your computer.";

/** xterm loads with the first screen shown. */
const TerminalView = lazyComponent(() => import("./terminal-view").then((m) => m.TerminalView));

export function TerminalPane({ api, role, name, foot, focusOnOpen, ideas = null, popOut = null }: {
	api: TerminalsApi;
	role: TerminalRole;
	/** What the screen's agent is called: the teacher's name, or background work's. */
	name: string;
	foot: TerminalFooter;
	/** The learner opened it: the screen takes the keyboard. Opened by
	 *  itself, it waits for a click in the screen. */
	focusOnOpen: boolean;
	/** What the teacher can be asked (starter-model.ts): the lines for this page and the whole list. None leaves them out. */
	ideas?: { starters: readonly string[]; everything: readonly IdeaGroup[] } | null;
	/** Pops the screen out into a window of its own (api.popOut); none leaves its key out. */
	popOut?: TerminalsApi["popOut"];
}) {
	const term = api[role]!;
	const [focusKey, setFocusKey] = useState(0);
	const [error, setError] = useState<string | null>(null);
	// A refusal shows until the screen asks something else or the footer changes.
	useEffect(() => setError(null), [term.id, term.prompt, foot.text, foot.assist?.kind, foot.startAgain]);
	const live = !term.ended;
	// Running: it reached godspeed. Asked: it waits for the learner (a question, a sign-in).
	const running = live && !!api.facts[role]?.checkedIn;
	const asked = live && (!!term.prompt || !!term.url);
	const refocus = () => setFocusKey((n) => n + 1);
	// The teacher's Start again goes back to the chat that ended, when it was used.
	const lastChat = role === "teacher" ? api.chats.find((c) => c.agent === term.agent && c.at >= term.startedAt) : undefined;
	const startAgain = async (resume?: string) => setError(await api.start(role, term.agent, resume));
	// A clicked line folds the row at once; a refusal says why, and brings an unused chat's row back.
	const [sentFrom, setSentFrom] = useState<string | null>(null);
	// The Ideas key unfolded the row; the whole list is open.
	const [rowWanted, setRowWanted] = useState(false);
	const [listWanted, setListWanted] = useState(false);
	const canAsk = !!ideas && ideas.starters.length > 0 && takesLine(api.facts[role]);
	const used = !!lastChat || sentFrom === term.id;
	const rowShown = canAsk && (!used || rowWanted);
	const listShown = rowShown && listWanted;
	const sendIdea = (line: string) => {
		setSentFrom(term.id);
		setRowWanted(false);
		setListWanted(false);
		void api.send(role, line).then((refused) => {
			setError(refused);
			if (refused) setSentFrom(null);
		});
		refocus();
	};
	const row = useRef<HTMLDivElement>(null);
	useMenuDismiss(listShown, useCallback(() => setListWanted(false), []), row);
	const attaches = role === "teacher" && running;
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
				className="relative flex min-h-0 min-w-0 flex-1 flex-col"
				onDragOver={(e) => attaches && e.dataTransfer.types.includes("Files") && e.preventDefault()}
				onDrop={(e) => {
					if (!attaches || e.dataTransfer.files.length === 0) return;
					e.preventDefault();
					void attach(Array.from(e.dataTransfer.files));
				}}
			>
				<TerminalView key={term.id} id={term.id} ended={!live} focusOnOpen={focusOnOpen} focusKey={focusKey} files={files} onLink={onLink} />
				{ideas && <IdeaList groups={listShown ? ideas.everything : null} label={`Everything ${name} can do`} onSend={sendIdea} />}
			</div>
			<div ref={row} className="shrink-0">
				{ideas && <StarterKeys starters={rowShown ? ideas.starters : null} onSend={sendIdea} everything={{ label: `Everything ${name} can do`, open: listShown, toggle: () => setListWanted(!listShown) }} />}
			</div>
			<ScreenFooter
				text={error ?? foot.text}
				onAttach={attaches ? (files) => void attach(files) : null}
				onPaste={
					running || asked
						? () => {
								void api.paste(role).then(setError);
								refocus();
							}
						: null
				}
				onPopOut={popOut ? () => void popOut(name).then(setError) : null}
				ideas={
					canAsk && used
						? {
								open: rowShown,
								toggle: () => {
									setRowWanted(!rowShown);
									setListWanted(false);
								},
							}
						: null
				}
				onStop={live ? () => void api.stop(role) : null}
				off={`Turn off ${name}`}
				get={foot.get}
				assist={
					foot.assist && {
						label: foot.assist.label,
						run: () => {
							void api.answer(role, foot.assist!.kind).then(setError);
							refocus();
						},
					}
				}
				onStartAgain={foot.startAgain ? () => void startAgain(lastChat?.id) : null}
				again={lastChat ? "Continue" : chatGone(term.ended) ? "New chat" : "Start again"}
				onNewChat={foot.startAgain && lastChat ? () => void startAgain() : null}
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
