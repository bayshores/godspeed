/**
 * One teaching area's full instructions, in a panel over the settings
 * dialog: a tab per part, the text in an editor, Reset to original and
 * Save. A saved version is used in place of the original right away (next
 * turn); Reset deletes it.
 */

import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { PART_NAMES, type PromptSegmentInfo, type TeachingArea } from "@/core";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { OUTLINE_BUTTON } from "./controls.tsx";

export function InstructionsPanel({
	area,
	parts,
	onChanged,
	onClose,
}: {
	area: TeachingArea;
	parts: PromptSegmentInfo[];
	/** A part was saved or reset: re-read the segments. */
	onChanged: () => void;
	onClose: () => void;
}) {
	const [activePath, setActivePath] = useState(parts[0]?.path ?? "");
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const part = parts.find((p) => p.path === activePath) ?? parts[0];

	// Escape closes the panel only, not the dialog behind it.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	if (!part) return null;
	const current = part.overrideText ?? part.sourceText;
	const text = drafts[part.path] ?? current;
	const dirty = text !== current;
	const forget = (path: string) =>
		setDrafts((d) => {
			const { [path]: _gone, ...rest } = d;
			return rest;
		});

	/** One request at a time; a failed or unreachable one shows `failure`. */
	async function send(init: RequestInit, failure: string) {
		if (!part) return;
		const path = part.path;
		setError(null);
		setBusy(true);
		const res = await fetch(`/api/settings/prompts/${path}`, init).catch(() => null);
		setBusy(false);
		if (!res?.ok) return setError(failure);
		forget(path);
		onChanged();
	}

	function save() {
		// Saving the original text unchanged is the same as resetting.
		const init: RequestInit =
			text === part?.sourceText
				? { method: "DELETE" }
				: { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) };
		return send(init, "Could not save. Try again.");
	}

	function reset() {
		if (part?.overrideText === null) return forget(part.path);
		return send({ method: "DELETE" }, "Could not reset. Try again.");
	}

	return (
		<div className="absolute inset-0 z-10" data-testid="instructions-panel">
			<div className="lh-fade absolute inset-0 bg-black/65" data-state="open" onClick={onClose} aria-hidden />
			<div
				role="dialog"
				aria-label={`${area.label} instructions`}
				className="absolute inset-y-0 right-0 flex w-[620px] max-w-full flex-col border-l border-tone-2 bg-panel shadow-[-20px_0_40px_#000000cc]"
			>
				<header className="flex items-start justify-between gap-3 px-6 pb-3.5 pt-5">
					<span>
						<h3 className="text-lg font-bold text-ink">{area.label}</h3>
						<span className="text-[12.5px] text-ink-2">What the teacher reads before every lesson</span>
					</span>
					<Hint label="Close" side="left">
						<button
							type="button"
							aria-label="Close instructions"
							onClick={onClose}
							className="lh-press -mx-1.5 -mb-1.5 -mt-0.5 flex size-7 shrink-0 items-center justify-center text-ink-2 hover:text-ink"
						>
							<XIcon className="size-4" aria-hidden />
						</button>
					</Hint>
				</header>
				{parts.length > 1 && (
					<div role="tablist" aria-label="Parts" className="flex flex-wrap gap-1 px-6">
						{parts.map((p) => {
							const on = p.path === part.path;
							return (
								<button
									key={p.path}
									type="button"
									role="tab"
									aria-selected={on}
									onClick={() => setActivePath(p.path)}
									className={cn(
										"lh-press flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px]",
										on ? "bg-tone-2 font-bold text-ink" : "bg-tone text-ink-2 hover:text-ink",
									)}
								>
									{PART_NAMES[p.path] ?? p.path}
									{p.overrideText !== null && (
										<>
											<span className="size-1.5 rounded-full bg-ink" aria-hidden />
											<span className="sr-only"> edited</span>
										</>
									)}
								</button>
							);
						})}
					</div>
				)}
				<div className="flex min-h-0 flex-1 flex-col px-6 py-[18px]">
					<textarea
						value={text}
						aria-label={`${PART_NAMES[part.path] ?? part.path} instructions`}
						data-testid="instructions-editor"
						spellCheck={false}
						onChange={(e) => setDrafts((d) => ({ ...d, [part.path]: e.target.value }))}
						className="min-h-0 flex-1 resize-none border border-tone-2 bg-background px-[18px] py-4 font-mono text-[12.5px] leading-relaxed text-ink-body outline-none focus-visible:border-ink-3"
					/>
				</div>
				<footer className="flex items-center justify-between gap-3 px-6 pb-5">
					<span className="flex items-center gap-2 text-[12.5px] text-ink-2">
						{error ?? (
							<>
								{part.overrideText !== null && <span className="size-1.5 rounded-full bg-ink" aria-hidden />}
								{dirty ? "Unsaved changes" : part.overrideText !== null ? "Your version is in use" : "The original is in use"}
							</>
						)}
					</span>
					<span className="flex items-center gap-2">
						<button type="button" disabled={busy || (part.overrideText === null && !dirty)} onClick={() => void reset()} className={OUTLINE_BUTTON}>
							Reset to original
						</button>
						<button
							type="button"
							disabled={busy || !dirty}
							onClick={() => void save()}
							className="lh-press bg-primary px-3 py-[5px] text-[13px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40"
						>
							Save
						</button>
					</span>
				</footer>
			</div>
		</div>
	);
}
