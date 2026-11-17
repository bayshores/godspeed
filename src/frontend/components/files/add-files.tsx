import { useRef } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { SPACE_FILE_ACCEPT } from "./files-model";

/** "Add files" (the page's main button): opens the file picker. Each file's first read sorts it
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
				className="lh-btn lh-btn-main h-auto w-full justify-center gap-2.5 py-3.5 text-[17px]"
			>
				<PixelIcon name="plus" className="h-3.5" />
				Add files
			</button>
		</>
	);
}
