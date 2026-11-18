import { useRef } from "react";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { SPACE_FILE_ACCEPT } from "./files-model";

/** "Add files", a word in the top bar: opens the file picker. Each file's first read sorts it
 *  into study material or space info. */
export function AddFilesButton({ disabled, onAdd }: { disabled?: boolean; onAdd: (files: File[]) => void }) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={inputRef}
				type="file"
				multiple
				accept={SPACE_FILE_ACCEPT}
				className="hidden"
				data-testid="space-file-input"
				onChange={(e) => {
					const picked = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (picked.length > 0) onAdd(picked);
				}}
			/>
			<button
				type="button"
				data-testid="space-add-files"
				disabled={disabled}
				onClick={() => inputRef.current?.click()}
				className={barWord(false)}
			>
				Add files
			</button>
		</>
	);
}
