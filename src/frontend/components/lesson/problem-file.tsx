/** A homework problem's file and the page it is on. */
export type ProblemFileRef = { name: string; path: string | null; page: number | undefined };

/**
 * The open homework problem's source, "file.pdf, page N", at the end of the
 * "Your turn" title line: a click opens a PDF, or shows another file in its
 * folder. Nothing on the web, where the desktop cannot open files.
 */
export function ProblemFile({ file }: { file: ProblemFileRef }) {
	const desktop = typeof window !== "undefined" ? window.lh : undefined;
	const open = /\.pdf$/i.test(file.name) ? desktop?.openPath : desktop?.showInFolder;
	const { path } = file;
	if (!open || !path) return null;
	const page = file.page === undefined ? "" : `, page ${file.page}`;
	return (
		<button type="button" data-testid="lesson-assignment" title={file.name + page} onClick={() => void open(path)} className="lh-btn lh-btn-small lh-btn-quiet ml-auto min-w-0 max-w-[34ch]">
			<span className="flex min-w-0">
				<span className="truncate">{file.name}</span>
				{page && <span className="shrink-0">{page}</span>}
			</span>
		</button>
	);
}
