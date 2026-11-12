import { useCallback, useRef, useState } from "react";
import { linkSpaceFolder, uploadSpaceFiles } from "@/frontend/components/files/space-files-api";
import { SPACE_FILE_ACCEPT } from "@/frontend/components/files/files-model";
import { FIELD } from "@/frontend/components/ui/field";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";
import { pickedLabel, type Picked } from "./space-step-model";
import { StepSheet } from "./step-sheet";
import { useReturn } from "./use-return";

/** Step 2: name the first space and optionally add its notes (a folder to
 *  link or files to copy in). Skip goes on without a space. */
export function SpaceStep({ onDone }: { onDone: (spaceId: string | null) => void }) {
	const [name, setName] = useState("");
	const [picked, setPicked] = useState<Picked>(null);
	const [over, setOver] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Set when the space was made but some files failed: Continue goes on.
	const [madeId, setMadeId] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const canSave = (name.trim() !== "" || madeId !== null) && !busy;

	const save = useCallback(async () => {
		if (madeId) return onDone(madeId);
		if (name.trim() === "" || busy) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/spaces", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: name.trim() }),
			});
			const body = (await res.json().catch(() => ({}))) as { space?: { id: string }; error?: string };
			if (!res.ok || !body.space) {
				setError(body.error ?? "Couldn't create the space. Try again.");
				return;
			}
			const id = body.space.id;
			const failed =
				picked?.kind === "folder" ? await linkSpaceFolder(id, picked.path) : picked?.kind === "files" ? await uploadSpaceFiles(id, picked.files, "study") : null;
			if (failed) {
				// The space exists; say what didn't make it and let them go on.
				setError(`The space was made, but some files didn't go in:\n${failed}\nYou can add them later on its Files page.`);
				setPicked(null);
				setMadeId(id);
				return;
			}
			onDone(id);
		} catch {
			setError("Network error. Try again.");
		} finally {
			setBusy(false);
		}
	}, [busy, madeId, name, onDone, picked]);
	useReturn(canSave ? () => void save() : null);

	const choose = () => {
		const pick = typeof window !== "undefined" ? window.lh?.pickFolder : undefined;
		if (pick) {
			void pick().then((path) => {
				if (path) setPicked({ kind: "folder", path });
			});
		} else fileInput.current?.click();
	};

	const onDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setOver(false);
		// The dropped data is gone after the first await, so all of it is read first.
		const items = Array.from(e.dataTransfer.items ?? []);
		const folderItem = items.find((i) => i.webkitGetAsEntry?.()?.isDirectory);
		const folder = folderItem?.getAsFile();
		const files = Array.from(e.dataTransfer.files ?? []);
		if (folderItem) {
			const path = folder ? await window.lh?.pathForFile?.(folder) : undefined;
			if (path) setPicked({ kind: "folder", path });
			// In the desktop app a "" means this OS gives the page no path (Linux).
			else setError(window.lh && path === "" ? "To link a folder, click this box and choose it." : "A folder can be linked in the desktop app. Here, drop the files themselves.");
			return;
		}
		if (files.length > 0) setPicked({ kind: "files", files });
	};

	const summary = pickedLabel(picked);
	return (
		<StepSheet at={2} title="Add your first space" sub="Each space gets its own lessons and knowledge graph. You can add more later.">
			<div className="flex flex-col gap-1.5">
				<label className={LABEL_TEXT} htmlFor="onboarding-space-name">
					Space name
				</label>
				<input
					id="onboarding-space-name"
					data-testid="onboarding-space-name"
					autoFocus
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="For example, CSE 21: Discrete Math"
					className={FIELD}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<span className={LABEL_TEXT}>Notes and slides (optional)</span>
				<input
					ref={fileInput}
					type="file"
					multiple
					accept={SPACE_FILE_ACCEPT}
					className="hidden"
					onChange={(e) => {
						const files = Array.from(e.target.files ?? []);
						e.target.value = "";
						if (files.length > 0) setPicked({ kind: "files", files });
					}}
				/>
				<button
					type="button"
					data-testid="onboarding-drop"
					onClick={choose}
					onDragOver={(e) => {
						e.preventDefault();
						setOver(true);
					}}
					onDragLeave={() => setOver(false)}
					onDrop={(e) => void onDrop(e)}
					className={cn(
						"lh-press flex h-[150px] w-full flex-col items-center justify-center gap-1.5 rounded border-2 bg-background px-6 text-center",
						over ? "border-ink" : "border-line hover:border-ink-3",
					)}
				>
					<span className="text-[17px] text-ink">{summary ? "Drop to replace, or click to choose again" : "Drop files or a folder here"}</span>
					<span data-testid="onboarding-drop-hint" className="max-w-full truncate text-sm text-ink-2">
						{summary ?? "A linked folder keeps adding new notes by itself."}
					</span>
				</button>
			</div>
			{error && (
				<p role="alert" className="whitespace-pre-wrap text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className="flex items-center pt-2">
				{!madeId && (
					<button type="button" data-testid="onboarding-skip" className="lh-btn lh-btn-quiet text-[15px]" onClick={() => onDone(null)}>
						Skip
					</button>
				)}
				<button type="button" data-testid="onboarding-space-continue" disabled={!canSave} className="lh-btn lh-btn-main ml-auto text-[15px]" onClick={() => void save()}>
					{busy ? "Adding…" : "Continue"}
				</button>
			</div>
		</StepSheet>
	);
}
