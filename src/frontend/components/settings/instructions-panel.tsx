/**
 * One teaching area's full instructions, on a page of their own: a tab per
 * part, the text in an editor, Reset to original and Save. A saved version
 * is used in place of the original right away (next turn); Reset deletes it.
 */

import { useEffect, useId, useState } from "react";
import { PART_NAMES, type PromptSegmentInfo, type TeachingArea } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { tabListKeys } from "@/frontend/components/ui/tab-list";
import { cn } from "@/frontend/lib/utils";
import { SMALL_KEY } from "./controls.tsx";

export function InstructionsPanel({
	area,
	parts,
	teacherName,
	onChanged,
	onClose,
}: {
	area: TeachingArea;
	parts: PromptSegmentInfo[];
	teacherName: string;
	/** A part was saved or reset: re-read the segments. */
	onChanged: () => void;
	onClose: () => void;
}) {
	const [activePath, setActivePath] = useState(parts[0]?.path ?? "");
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const part = parts.find((p) => p.path === activePath) ?? parts[0];
	const tabsId = useId();

	// Escape goes back to the teaching areas.
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
		<section aria-label={`${area.label} instructions`} data-testid="instructions-panel" className="flex flex-col gap-6">
			<div className="flex items-center gap-4">
				<button type="button" onClick={onClose} className="lh-btn shrink-0 text-[15px]">
					<PixelIcon name="chevron" className="-scale-x-100" />
					Teaching
				</button>
				<div className="min-w-0">
					<h2 className="text-[30px] leading-9 text-ink">{area.label}, full instructions</h2>
					<p className="text-[15px] text-ink-2">What {teacherName} reads before every lesson</p>
				</div>
			</div>
			{parts.length > 1 && (
				<div
					role="tablist"
					aria-label="Parts"
					onKeyDown={tabListKeys(parts.indexOf(part), parts.length, (i) => setActivePath(parts[i]!.path))}
					className="flex flex-wrap gap-1.5 border-b-2 border-edge"
				>
					{parts.map((p, i) => {
						const on = p.path === part.path;
						return (
							<button
								key={p.path}
								type="button"
								role="tab"
								id={`${tabsId}-${i}`}
								aria-selected={on}
								aria-controls={`${tabsId}-panel`}
								tabIndex={on ? 0 : -1}
								onClick={() => setActivePath(p.path)}
								className={cn(
									"lh-press -mb-0.5 flex items-baseline gap-2 border-b-2 px-3.5 py-2.5 text-lg",
									on ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
								)}
							>
								{PART_NAMES[p.path] ?? p.path}
								{p.overrideText !== null && <span className="text-[15px] font-normal text-ink-2">changed</span>}
							</button>
						);
					})}
				</div>
			)}
			<div
				role={parts.length > 1 ? "tabpanel" : undefined}
				id={`${tabsId}-panel`}
				aria-labelledby={parts.length > 1 ? `${tabsId}-${parts.indexOf(part)}` : undefined}
			>
				<textarea
					value={text}
					aria-label={`${PART_NAMES[part.path] ?? part.path} instructions`}
					data-testid="instructions-editor"
					spellCheck={false}
					onChange={(e) => setDrafts((d) => ({ ...d, [part.path]: e.target.value }))}
					className="h-[470px] w-full resize-none rounded border-[1.5px] border-ink bg-background px-7 py-[22px] text-lg leading-relaxed text-ink"
				/>
			</div>
			<footer className="flex items-center gap-2.5">
				<span className="min-w-0 flex-1 text-[15px] text-ink-2">
					{error ?? (dirty ? "Unsaved changes" : part.overrideText !== null ? "Your version is in use" : "The original is in use")}
				</span>
				<button type="button" disabled={busy || (part.overrideText === null && !dirty)} onClick={() => void reset()} className={SMALL_KEY}>
					Reset to original
				</button>
				<button type="button" disabled={busy || !dirty} onClick={() => void save()} className={cn(SMALL_KEY, "lh-btn-main")}>
					Save
				</button>
			</footer>
		</section>
	);
}
