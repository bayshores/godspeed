"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon } from "lucide-react";
import {
	CHEAT_SHEET_PAPERS,
	INSTRUCTIONS_MAX,
	PAPERS,
	STATUS_COLOR,
	planLines,
	prefsForWriting,
	sheetContent,
	type CheatSheetPaper,
	type CheatSheetPrefs,
	type CheatSheetRules,
	type CheatSheetView,
} from "@/core";
import { useAgentStatus } from "@/components/agent-status";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { cn } from "@/lib/utils";
import { Segmented } from "./segmented";
import { studioPath, useCheatSheet } from "./use-cheat-sheet";

/**
 * THE CHEAT SHEET SETUP: one short dialog, rules first. Opening it asks
 * the agent to read the rules in the class's files (once); its answer
 * fills the fields for the learner to check. "Make my cheat sheet" saves
 * the rules and choices and starts the sheet in the studio.
 */
export function SetupDialog({ classId, deadlineId, open, onClose }: { classId: string; deadlineId: string; open: boolean; onClose: () => void }) {
	const presence = usePresence(open);
	if (!presence.mounted) return null;
	return createPortal(<SetupDialogInner classId={classId} deadlineId={deadlineId} state={presence.state} onClose={onClose} />, document.body);
}

function SetupDialogInner({ classId, deadlineId, state, onClose }: { classId: string; deadlineId: string; state: "open" | "closed"; onClose: () => void }) {
	const router = useRouter();
	const { view, act } = useCheatSheet(classId, deadlineId);
	const agent = useAgentStatus();
	const [draft, setDraft] = useState<{ rules: CheatSheetRules; prefs: CheatSheetPrefs } | null>(null);
	const touched = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const asked = useRef(false);

	// The saved rules fill the fields until the learner changes one (the
	// agent's reading may arrive while the dialog is open).
	useEffect(() => {
		if (view && !touched.current) setDraft({ rules: view.sheet.rules, prefs: view.sheet.prefs });
	}, [view]);
	useEffect(() => {
		if (!view || asked.current) return;
		asked.current = true;
		if (!view.sheet.confirmedAt && !view.sheet.rulesRead) void act({ action: "read-rules" });
	}, [view, act]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			if (!busy) onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [busy, onClose]);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});

	const edit = (next: { rules: CheatSheetRules; prefs: CheatSheetPrefs }) => {
		touched.current = true;
		setDraft(next);
	};

	const make = async () => {
		if (!draft) return;
		setBusy(true);
		setError(null);
		const failed = await act({ action: "make", rules: draft.rules, prefs: draft.prefs });
		setBusy(false);
		if (failed) {
			setError(failed);
			return;
		}
		onClose();
		router.push(studioPath(deadlineId));
	};

	return (
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70" {...backdropDismiss}>
			{view && draft ? (
				<SetupBody
					state={state}
					view={view}
					rules={draft.rules}
					prefs={draft.prefs}
					agentName={agent?.name}
					agentAway={!!agent && !agent.connected && !agent.teaching}
					busy={busy}
					error={error}
					onChange={edit}
					onClose={onClose}
					onMake={() => void make()}
				/>
			) : (
				<div className="lh-dialog h-[520px] w-[840px] max-w-[calc(100vw-2rem)] bg-panel" aria-hidden />
			)}
		</div>
	);
}

/** Where the rules came from, above the fields. */
function introLine(view: CheatSheetView, agentName: string | undefined, agentAway: boolean): string {
	const who = agentName ?? "Your agent";
	// The reading waits in the agent's queue until one connects.
	if (view.readingRules && agentAway) return `${who} will read your syllabus for the rules once it connects. You can pick them yourself too.`;
	if (view.readingRules) return `${who} is reading your syllabus for the rules. You can pick them yourself too.`;
	if (view.sheet.rules.source) return `${who} read these rules in your syllabus. Check them and you're done here.`;
	if (view.sheet.rulesRead) return "Your syllabus doesn't say, so pick what your class allows.";
	return "Pick what your class allows. You can change it later.";
}

const LABEL = "text-[13px] font-bold text-ink-2";

export const INSTRUCTIONS_PLACEHOLDER = "Optional. Like: use my professor's notation, put Bayes' rule first, skip what's on the formula sheet.";

/** The dialog's body: pure, for render tests. */
export function SetupBody({
	view,
	rules,
	prefs,
	agentName,
	agentAway,
	busy,
	error,
	onChange,
	onClose,
	onMake,
	state = "open",
}: {
	view: CheatSheetView;
	rules: CheatSheetRules;
	prefs: CheatSheetPrefs;
	agentName: string | undefined;
	/** No agent connected, so a reading has not started. */
	agentAway: boolean;
	busy: boolean;
	error: string | null;
	onChange: (next: { rules: CheatSheetRules; prefs: CheatSheetPrefs }) => void;
	onClose: () => void;
	onMake: () => void;
	state?: "open" | "closed";
}) {
	const dialogRef = useDialogFocus<HTMLDivElement>(state === "open");
	const setRules = (patch: Partial<CheatSheetRules>) => onChange({ rules: { ...rules, ...patch }, prefs });
	const lines = planLines(view.topics, view.mistakes, sheetContent({ rules, prefs }).includes("mistakes"));
	const nothing = view.topics.length === 0;
	const again = view.sheet.blocks.length > 0;
	return (
		<div
			ref={dialogRef}
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
			aria-label={`Make a cheat sheet for the ${view.deadlineName}`}
			data-testid="cheat-sheet-setup"
			data-state={state}
			onClick={(e) => e.stopPropagation()}
			className="lh-dialog flex max-h-[90vh] w-[840px] max-w-[calc(100vw-2rem)] flex-col gap-5 overflow-y-auto bg-panel p-5 shadow-[0_0_40px_#000000e6] outline outline-1 -outline-offset-1 outline-tone-2"
		>
			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-4">
					<h2 className="text-base font-bold text-ink">Make a cheat sheet for the {view.deadlineName}</h2>
					<button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="lh-press text-ink-2 hover:text-ink disabled:opacity-60">
						<XIcon className="size-4" aria-hidden />
					</button>
				</div>
				<p data-testid="cheat-sheet-setup-intro" className="font-prose text-[14.5px] text-ink-2">
					{introLine(view, agentName, agentAway)}
				</p>
			</div>

			<div className="flex flex-col gap-2.5">
				<p className={LABEL}>Paper you can bring</p>
				<div role="radiogroup" aria-label="Paper you can bring" className="grid grid-cols-4 gap-2.5">
					{CHEAT_SHEET_PAPERS.map((paper) => (
						<PaperCard key={paper} paper={paper} on={rules.paper === paper} onPick={() => setRules({ paper })} />
					))}
				</div>
			</div>

			<div className="flex flex-wrap items-start gap-x-8 gap-y-4">
				<div className="flex flex-col gap-2.5">
					<p className={LABEL}>Allowed</p>
					<Segmented
						label="Allowed"
						value={rules.allowed ? "yes" : "no"}
						options={[
							{ id: "yes", label: "Yes" },
							{ id: "no", label: "No" },
						]}
						onPick={(v) => setRules({ allowed: v === "yes" })}
					/>
				</div>
				<div className="flex flex-col gap-2.5">
					<p className={LABEL}>Written</p>
					<Segmented
						label="Written"
						value={rules.writing}
						options={[
							{ id: "printed", label: "Printed" },
							{ id: "by-hand", label: "By hand" },
						]}
						onPick={(writing) => onChange({ rules: { ...rules, writing }, prefs: prefsForWriting(prefs, writing) })}
					/>
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-2.5">
					<p className={LABEL}>Not allowed</p>
					<BannedChips banned={rules.banned} onChange={(banned) => setRules({ banned })} />
				</div>
			</div>

			<div data-testid="cheat-sheet-plan" className="flex flex-col gap-3.5 bg-tone px-5 py-4">
				<div className="flex items-baseline justify-between gap-4">
					<p className={LABEL}>What goes on it</p>
					<p className="text-[12.5px] text-ink-3">You can change this in the studio</p>
				</div>
				{!rules.allowed ? (
					<p className="font-prose text-[15px] text-ink-2">Your class doesn&apos;t allow a cheat sheet for this one, so there&apos;s nothing to make.</p>
				) : nothing ? (
					<p className="font-prose text-[15px] text-ink-2">Nothing is linked to this deadline yet. Link what it covers on its page first.</p>
				) : (
					<ul className="flex flex-col gap-2.5">
						{lines.map((l) => (
							<li key={l.text} className="flex items-center gap-3 font-prose text-[15px] text-ink">
								<span className="size-2.5 shrink-0" style={{ background: STATUS_COLOR[l.status] }} aria-hidden />
								{l.text}
							</li>
						))}
					</ul>
				)}
			</div>

			{rules.allowed && !nothing && (
				<label className="flex flex-col gap-2.5">
					<span className={LABEL}>Your instructions</span>
					<textarea
						data-testid="cheat-sheet-instructions"
						rows={2}
						maxLength={INSTRUCTIONS_MAX}
						value={prefs.instructions}
						onChange={(e) => onChange({ rules, prefs: { ...prefs, instructions: e.target.value } })}
						placeholder={INSTRUCTIONS_PLACEHOLDER}
						className="resize-none border border-edge bg-background px-3 py-2 text-[14px] leading-5 text-ink outline-none placeholder:text-ink-3 focus:border-ink"
					/>
				</label>
			)}

			{error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className="flex items-center justify-between gap-4">
				<p className="min-w-0 truncate text-[12.5px] text-ink-3">{rules.source ? `From ${rules.source}` : ""}</p>
				<div className="flex shrink-0 items-center gap-2">
					<button type="button" disabled={busy} onClick={onClose} className="lh-press px-3 py-1.5 text-sm font-bold text-ink-2 hover:text-ink disabled:opacity-60">
						Cancel
					</button>
					<button
						type="button"
						data-testid="cheat-sheet-make"
						data-autofocus
						disabled={busy || !rules.allowed || nothing}
						onClick={onMake}
						className="lh-press bg-ink px-4 py-[9px] text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-60"
					>
						{again ? "Make it again" : "Make my cheat sheet"}
					</button>
				</div>
			</div>
		</div>
	);
}

/** A paper choice: its shape drawn to scale, name and size. */
function PaperCard({ paper, on, onPick }: { paper: CheatSheetPaper; on: boolean; onPick: () => void }) {
	const p = PAPERS[paper];
	const scale = Math.min(66 / p.heightIn, 70 / p.widthIn);
	return (
		<button
			type="button"
			role="radio"
			aria-checked={on}
			data-testid={`cheat-sheet-paper-${paper}`}
			onClick={onPick}
			className={cn("lh-press flex flex-col items-center gap-1.5 px-3 pt-4 pb-3", on ? "bg-background outline outline-1 -outline-offset-1 outline-ink" : "bg-background/60 hover:bg-background")}
		>
			<span className="flex h-[70px] items-center" aria-hidden>
				<span className="relative" style={{ width: p.widthIn * scale, height: p.heightIn * scale, background: on ? "var(--lh-ink-max)" : "var(--lh-ink-3)" }}>
					{p.sides === 2 && <span className="absolute inset-y-0 right-0 w-2 bg-black/30" />}
				</span>
			</span>
			<span className="text-sm font-bold text-ink">{p.label}</span>
			<span className="font-mono text-[11.5px] text-ink-3">{p.size}</span>
		</button>
	);
}

/** What the class doesn't allow: chips with an x, and Add. */
function BannedChips({ banned, onChange }: { banned: string[]; onChange: (banned: string[]) => void }) {
	const [adding, setAdding] = useState<string | null>(null);
	const add = () => {
		const text = adding?.trim();
		if (text) onChange([...banned, text]);
		setAdding(null);
	};
	return (
		<div className="flex flex-wrap items-center gap-2">
			{banned.map((b) => (
				<span key={b} className="flex items-center gap-2 bg-tone-2 py-[7px] pr-2 pl-3 text-[13.5px] text-ink">
					{b}
					<button type="button" aria-label={`Allow ${b}`} onClick={() => onChange(banned.filter((x) => x !== b))} className="lh-press text-ink-2 hover:text-ink">
						<XIcon className="size-3.5" aria-hidden />
					</button>
				</span>
			))}
			{adding === null ? (
				<button
					type="button"
					data-testid="cheat-sheet-ban-add"
					onClick={() => setAdding("")}
					className="lh-press flex items-center gap-1.5 px-3 py-[7px] text-[13.5px] text-ink-2 outline outline-1 -outline-offset-1 outline-tone-2 hover:text-ink"
				>
					<PlusIcon className="size-3.5" aria-hidden />
					Add
				</button>
			) : (
				<input
					autoFocus
					aria-label="Something not allowed"
					value={adding}
					maxLength={60}
					placeholder="Worked examples"
					onChange={(e) => setAdding(e.target.value)}
					onBlur={add}
					onKeyDown={(e) => {
						if (e.key === "Enter") add();
					}}
					className="w-48 border border-edge bg-background px-3 py-[6px] text-[13.5px] text-ink placeholder:text-ink-3 focus:border-ink"
				/>
			)}
		</div>
	);
}
