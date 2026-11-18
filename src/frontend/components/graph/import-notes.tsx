import { useRef } from "react";
import { barWord } from "@/frontend/components/top-bar/bar-look";

/** "Add files", a word in the top bar of the graph with no space: picks notes files right here (a space adds files on its Files tab). */
export function ImportNotes({ importing, onImportFiles }: { importing: boolean; onImportFiles: (files: FileList | null) => void }) {
	const fileRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={fileRef}
				type="file"
				multiple
				accept=".md,.markdown,.txt"
				className="hidden"
				onChange={(e) => {
					onImportFiles(e.target.files);
					e.target.value = ""; // the same file can be picked again
				}}
			/>
			<button type="button" data-testid="import-notes" disabled={importing} onClick={() => fileRef.current?.click()} className={barWord(false)}>
				{importing ? "Adding…" : "Add files"}
			</button>
		</>
	);
}
