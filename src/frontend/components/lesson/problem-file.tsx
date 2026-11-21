import type { LessonDocument } from "@/shared/core";
import { pageKeyWords } from "./document-model";

/** The open problem's file, the page it is on, whether that file is the lesson's first, and
 *  what shows that page in the Document panel. */
export type ProblemFileRef = { document: LessonDocument; page: number | undefined; first: boolean; onShow: () => void };

/**
 * The key on the "Your turn" title line for the open problem's place: "Page 4" (with the file's
 * name when it is not the lesson's first) opens the Document panel at that page with the problem
 * boxed. A file that is not a PDF is shown in its folder on the desktop, and shows no key on the web.
 */
export function ProblemFile({ file }: { file: ProblemFileRef }) {
	const { document: doc, page } = file;
	if (doc.pdf) {
		if (page === undefined) return null;
		const words = pageKeyWords(page, file.first ? null : doc.name);
		// A long name shortens; the page stays whole.
		return (
			<button type="button" data-testid="lesson-assignment" title={(words.file ?? "") + words.page} onClick={file.onShow} className="lh-btn lh-btn-small lh-btn-quiet min-w-0 max-w-[34ch]">
				<span className="flex min-w-0">
					{words.file && <span className="truncate">{words.file}</span>}
					<span className="shrink-0">{words.page}</span>
				</span>
			</button>
		);
	}
	const open = typeof window !== "undefined" ? window.lh?.showInFolder : undefined;
	const { path } = doc;
	if (!open || !path) return null;
	return (
		<button type="button" data-testid="lesson-assignment" title={doc.name} onClick={() => void open(path)} className="lh-btn lh-btn-small lh-btn-quiet min-w-0 max-w-[34ch]">
			<span className="truncate">{doc.name}</span>
		</button>
	);
}
