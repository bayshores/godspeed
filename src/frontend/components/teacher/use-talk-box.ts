import { useCallback, useState } from "react";
import { isFolderAgent, type FolderAgent } from "@/shared/core";
import { useAttachmentDraft, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { readStorage, writeStorage } from "@/frontend/lib/storage";

/** The panel's box keeps its words for this app run, across pages, chats and the panel closing. */
let boxWords = "";
/** The key its waiting files are kept under (useAttachmentDraft). */
const BOX_FILES = "teacher-panel";
/** The model picked for the chat the box's next message makes, with the agent it is for. It is
 *  kept across a reload, so the pick reaches the server with that message. */
const NEXT_MODEL = "teacher-panel-next-model";

interface NextModel {
	agent: FolderAgent;
	model: string;
}

/** The box's words and files, which outlive the chat shown, and the model the next new chat starts on. */
export interface Box {
	text: string;
	setText: (next: string | ((now: string) => string)) => void;
	files: AttachmentDraft;
	/** The model picked for the next new chat on `agent`; none for another agent's pick. */
	nextModel: (agent: FolderAgent | null) => string | null;
	/** Keeps a pick for the next new chat; null once a chat took it. */
	pickNext: (pick: NextModel | null) => void;
}

/** A kept pick that can't be read is no pick: the learner picks again. */
function readNext(): NextModel | null {
	try {
		const kept = JSON.parse(readStorage(NEXT_MODEL) ?? "null") as Partial<NextModel> | null;
		return kept && isFolderAgent(kept.agent) && typeof kept.model === "string" && kept.model ? { agent: kept.agent, model: kept.model } : null;
	} catch {
		return null;
	}
}

export function useBox(): Box {
	const [text, show] = useState(boxWords);
	const setText = useCallback((next: string | ((now: string) => string)) => {
		boxWords = typeof next === "function" ? next(boxWords) : next;
		show(boxWords);
	}, []);
	const [next, setNext] = useState(readNext);
	const nextModel = useCallback((agent: FolderAgent | null) => (next && next.agent === agent ? next.model : null), [next]);
	const pickNext = useCallback((pick: NextModel | null) => {
		writeStorage(NEXT_MODEL, pick && JSON.stringify(pick));
		setNext(pick);
	}, []);
	return { text, setText, files: useAttachmentDraft(BOX_FILES), nextModel, pickNext };
}
