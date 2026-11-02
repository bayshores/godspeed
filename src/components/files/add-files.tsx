import { useCallback, useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";
import { useMenuDismiss } from "@/components/use-menu-dismiss";
import { CLASS_FILE_ACCEPT, kindTitle } from "./files-model";

const ITEM = "lh-press flex flex-col gap-0.5 px-2.5 py-[7px] text-left hover:bg-tone";

/** What each kind does, under its name in the menu. */
const KIND_NOTE = { study: "Turned into facts", info: "Read by the teacher only" } as const;

/** "Add files": pick the kind, then the files. */
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
				accept={CLASS_FILE_ACCEPT}
				className="hidden"
				data-testid="class-file-input"
				onChange={(e) => {
					const picked = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (picked.length > 0) onAdd(kindRef.current, picked);
				}}
			/>
			<button
				ref={anchorRef}
				type="button"
				data-testid="class-add-files"
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				className="lh-press flex shrink-0 items-center gap-[7px] bg-ink px-3 py-[7px] text-sm font-bold text-background hover:bg-ink-max disabled:opacity-60"
			>
				<PlusIcon className="size-3.5" aria-hidden />
				Add files
			</button>
			<MenuShell open={open} anchorRef={anchorRef} testid="class-add-files-menu" preferredSide="down" align="right" menuClass="lh-popup flex w-[220px] flex-col gap-0.5 p-1.5">
				{(["study", "info"] as const).map((kind) => (
					<button role="menuitem" key={kind} type="button" data-testid={`class-add-${kind}`} onClick={() => pick(kind)} className={ITEM}>
						<span className="text-[13.5px] text-ink">{kindTitle(kind)}</span>
						<span className="text-[12.5px] text-ink-3">{KIND_NOTE[kind]}</span>
					</button>
				))}
			</MenuShell>
		</>
	);
}
