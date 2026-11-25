import { useCallback, useState } from "react";
import { useAttachmentDraft, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";

/** The panel's box keeps its words for this app run, across pages, chats and the panel closing. */
let boxWords = "";
/** The key its waiting files are kept under (useAttachmentDraft). */
const BOX_FILES = "teacher-panel";

/** The box's words and files, which outlive the chat shown. */
export interface Box {
	text: string;
	setText: (next: string | ((now: string) => string)) => void;
	files: AttachmentDraft;
}

export function useBox(): Box {
	const [text, show] = useState(boxWords);
	const setText = useCallback((next: string | ((now: string) => string)) => {
		boxWords = typeof next === "function" ? next(boxWords) : next;
		show(boxWords);
	}, []);
	return { text, setText, files: useAttachmentDraft(BOX_FILES) };
}
