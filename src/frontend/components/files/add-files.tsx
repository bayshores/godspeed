import { Fragment, useCallback, useRef, useState } from "react";
import { MenuShell } from "@/frontend/components/menu-shell";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { SPACE_FILE_ACCEPT, kindNote, kindTitle } from "./files-model";

const ITEM = "lh-press -mx-2 flex flex-col gap-px px-2 py-1 text-left hover:bg-tone";

/** "Add files" (the page's main button): pick the kind, then the files. */
export function AddFilesButton({ disabled, onAdd }: { disabled?: boolean; onAdd: (kind: "study" | "info", files: File[]) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const kindRef = useRef<"study" | "info">("study");
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const pick = (kind: "study" | "info") => {
		setOpen(false);
		kindRef.current = kind;
		inputRef.current?.click();
	};
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
					if (picked.length > 0) onAdd(kindRef.current, picked);
				}}
			/>
			<button
				ref={anchorRef}
				type="button"
				data-testid="space-add-files"
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				className="lh-btn lh-btn-main h-auto w-full justify-center gap-2.5 py-3.5 text-[17px]"
			>
				<PixelIcon name="plus" className="h-3.5" />
				Add files
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="space-add-files-menu" preferredSide="down" menuClass="lh-popup flex w-[420px] flex-col gap-2.5 px-[18px] py-3.5">
				{(["study", "info"] as const).map((kind, i) => (
					<Fragment key={kind}>
						{i > 0 && <span aria-hidden className="border-t-2 border-dotted border-edge" />}
						<button role="menuitem" type="button" data-testid={`space-add-${kind}`} onClick={() => pick(kind)} className={ITEM}>
							<span className="text-lg text-ink">{kindTitle(kind)}</span>
							<span className="text-base text-ink-2">{kindNote(kind)}</span>
						</button>
					</Fragment>
				))}
			</MenuShell>
		</>
	);
}
