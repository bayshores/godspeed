/**
 * One teaching area's full instructions, on a page of their own: a tab per
 * part, the text in an editor, Reset to original and Save. A saved version
 * is used in place of the original right away (next turn); Reset deletes it.
 * Reset and leaving with unsaved text ask first.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PART_NAMES, type PromptSegmentInfo, type TeachingArea } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { STRIP, useTabStrip } from "@/frontend/components/tab-strip";
import { FootQuestion } from "@/frontend/components/ui/foot-question";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { tabListKeys } from "@/frontend/components/ui/tab-list";
import { cn } from "@/frontend/lib/utils";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { SMALL_KEY } from "./controls.tsx";

/** Escape can ask to leave while the page is scrolled past its head. */
const intoView = (el: HTMLElement | null) => el?.scrollIntoView?.({ block: "nearest" });

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
	const { busy, error, run } = useGuardedAction();
	// "clear" is Reset on a part with no saved version: it only drops typed text.
	const [asking, setAsking] = useState<"reset" | "clear" | "discard" | null>(null);
	const part = parts.find((p) => p.path === activePath) ?? parts[0];
	const tabsId = useId();

	const unsaved = parts.some((p) => (drafts[p.path] ?? (p.overrideText ?? p.sourceText)) !== (p.overrideText ?? p.sourceText));
	// Leaving (Back, Escape) asks first when typed text would be lost; on a question Escape keeps editing.
	const leave = useCallback(() => {
		if (busy) return;
		if (asking) setAsking(null);
		else if (unsaved) setAsking("discard");
		else onClose();
	}, [busy, asking, unsaved, onClose]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			leave();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [leave]);

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
	async function change(init: RequestInit, failure: string) {
		if (!part) return;
		const path = part.path;
		const ok = await run(async () => ((await send(`/api/settings/prompts/${path}`, init)).error ? failure : null));
		if (!ok) return;
		forget(path);
		onChanged();
	}

	function save() {
		setAsking(null);
		// Saving the original text unchanged is the same as resetting.
		const init: RequestInit =
			text === part?.sourceText
				? { method: "DELETE" }
				: jsonInit("PUT", { text });
		return change(init, "Could not save. Try again.");
	}

	function reset() {
		setAsking(null);
		if (part?.overrideText === null) return forget(part.path);
		return change({ method: "DELETE" }, "Could not reset. Try again.");
	}

	const pick = (path: string) => {
		setAsking(null);
		setActivePath(path);
	};
	const question = asking === "reset" ? (
		<FootQuestion
			testid="instructions-reset"
			line="Reset to the original?"
			note="Your version is deleted."
			keep="Cancel"
			go="Reset"
			busy={busy}
			onKeep={() => setAsking(null)}
			onGo={() => void reset()}
		/>
	) : asking ? (
		<FootQuestion
			testid="instructions-discard"
			line="Discard your changes?"
			keep="Keep editing"
			go="Discard"
			quiet
			busy={busy}
			onKeep={() => setAsking(null)}
			onGo={asking === "clear" ? () => void reset() : onClose}
		/>
	) : null;
	// Leaving is asked where Back was pressed; a Reset question stays beside Reset.
	const leaving = asking === "discard";

	return (
		<section aria-label={`${area.label} instructions`} data-testid="instructions-panel" className="flex flex-col gap-6">
			<div ref={leaving ? intoView : undefined} className="flex min-h-[58px] scroll-mt-6 items-center gap-4">
				{leaving ? (
					question
				) : (
					<>
						<button type="button" onClick={leave} className="lh-btn shrink-0">
							<PixelIcon name="chevron" className="-scale-x-100" />
							Teaching
						</button>
						<div className="min-w-0">
							<h1 className="lh-page-title">{area.label}, full instructions</h1>
							<p className="text-ui text-ink-2">What {teacherName} reads before every lesson</p>
						</div>
					</>
				)}
			</div>
			{parts.length > 1 && <PartTabs parts={parts} lit={part} tabsId={tabsId} onPick={pick} />}
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
					className="h-[470px] w-full resize-none lh-well lh-notch px-7 py-[22px] text-item leading-relaxed text-ink"
				/>
			</div>
			<footer className="flex items-center gap-2.5">
				{question && !leaving ? (
					question
				) : (
					<>
						<span className="min-w-0 flex-1 text-ui text-ink-2">
							{error ?? (dirty ? "Unsaved changes" : part.overrideText !== null ? "Your version is in use" : "The original is in use")}
						</span>
						<button
							type="button"
							disabled={busy || (part.overrideText === null && !dirty)}
							onClick={() => setAsking(part.overrideText === null ? "clear" : "reset")}
							className={SMALL_KEY}
						>
							Reset to original
						</button>
						<button type="button" disabled={busy || !dirty} onClick={() => void save()} className={cn(SMALL_KEY, "lh-btn-main")}>
							Save
						</button>
					</>
				)}
			</footer>
		</section>
	);
}

/** A tab per part, drawn like every row of tabs: the lit one's underline slides to it, and a row too narrow scrolls. */
function PartTabs({ parts, lit, tabsId, onPick }: { parts: PromptSegmentInfo[]; lit: PromptSegmentInfo; tabsId: string; onPick: (path: string) => void }) {
	const rowRef = useRef<HTMLDivElement>(null);
	const underline = useLitMarker(rowRef, '[aria-selected="true"]', lit.path);
	const strip = useTabStrip('[aria-selected="true"]', lit.path);
	return (
		<div ref={rowRef} className="lh-tabs relative isolate">
			<div ref={underline} hidden aria-hidden className="lh-lit-marker lh-tab-line" />
			<div
				{...strip}
				role="tablist"
				aria-label="Parts"
				onKeyDown={tabListKeys(parts.indexOf(lit), parts.length, (i) => onPick(parts[i]!.path))}
				className={cn("flex gap-x-1.5", STRIP)}
			>
				{parts.map((p, i) => {
					const on = p.path === lit.path;
					return (
						<button
							key={p.path}
							type="button"
							role="tab"
							id={`${tabsId}-${i}`}
							aria-selected={on}
							aria-controls={`${tabsId}-panel`}
							tabIndex={on ? 0 : -1}
							onClick={() => onPick(p.path)}
							className="lh-press lh-tab"
						>
							{PART_NAMES[p.path] ?? p.path}
							{p.overrideText !== null && <span className="text-ui text-ink-2">changed</span>}
						</button>
					);
				})}
			</div>
		</div>
	);
}
