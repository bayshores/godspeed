import { useEffect, useState, type ReactNode } from "react";
import { BanIcon, CheckIcon, FileIcon, PenLineIcon, PrinterIcon } from "lucide-react";
import {
	CHEAT_SHEET_CONTENT,
	INSTRUCTIONS_MAX,
	PAPERS,
	STATUS_COLOR,
	TEXT_SIZES,
	bannedContent,
	type CheatSheet,
	type CheatSheetPrefs,
	type CheatSheetTextSize,
	type FitFix,
	type SheetTopic,
} from "@/core";
import { cn } from "@/lib/utils";
import { Segmented } from "./segmented";
import { INSTRUCTIONS_PLACEHOLDER } from "./setup-dialog";

/**
 * The studio's settings rail: the rules (Edit opens the setup), your
 * instructions with Remake sheet, what goes on it, text size, columns, ink,
 * and the topics left out. When the sheet
 * runs long, three ways to make it fit sit on top.
 */
export function Rail({
	sheet,
	leftOut,
	fixes,
	overLines,
	busy,
	onEditRules,
	onPrefs,
	onFix,
	onAdd,
	onRemake,
}: {
	sheet: CheatSheet;
	leftOut: readonly SheetTopic[];
	/** Ways to fit, when the sheet runs long. */
	fixes: readonly FitFix[];
	overLines: number;
	/** The agent is working: choices that send a request wait. */
	busy: boolean;
	onEditRules: () => void;
	onPrefs: (prefs: Partial<CheatSheetPrefs>) => void;
	onFix: (fix: FitFix) => void;
	onAdd: (topicId: string) => void;
	/** Absent before the first sheet (the setup makes that one). */
	onRemake?: () => void;
}) {
	const { rules, prefs } = sheet;
	const banned = bannedContent(rules.banned);
	const knownCold = leftOut.every((t) => t.status === "strong");
	return (
		<aside data-testid="cheat-sheet-rail" className="flex h-full w-[288px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-tone-2 px-[22px] py-6">
			{fixes.length > 0 && (
				<div data-testid="cheat-sheet-fixes" role="status" className="flex flex-col gap-2.5 px-3.5 py-3 outline outline-1 -outline-offset-1 outline-(--lh-ramp-1)">
					<p className="flex items-center gap-2.5 text-sm font-bold text-ink">
						<span className="size-2.5 shrink-0 bg-(--lh-ramp-1)" aria-hidden />
						About {overLines} {overLines === 1 ? "line doesn't" : "lines don't"} fit
					</p>
					<p className="text-[12.5px] text-ink-2">Pick one:</p>
					{fixes.map((f) => (
						<button
							key={f.kind}
							type="button"
							disabled={busy && f.kind === "tighten"}
							onClick={() => onFix(f)}
							className="lh-press bg-tone px-2.5 py-2 text-left text-[13px] font-bold text-ink hover:bg-tone-2 disabled:opacity-60"
						>
							{f.label}
						</button>
					))}
				</div>
			)}

			<Group
				label="Rules"
				action={
					<button type="button" data-testid="cheat-sheet-edit-rules" onClick={onEditRules} className="lh-press text-[13px] font-bold text-ink-2 hover:text-ink">
						Edit
					</button>
				}
			>
				{!rules.allowed ? (
					<Row icon={<BanIcon className="size-4" />}>Not allowed for this one</Row>
				) : (
					<>
						<Row icon={<FileIcon className="size-4" />}>{PAPERS[rules.paper].label}</Row>
						<Row icon={rules.writing === "by-hand" ? <PenLineIcon className="size-4" /> : <PrinterIcon className="size-4" />}>
							{rules.writing === "by-hand" ? "By hand" : "Printed"}
						</Row>
						{rules.banned.map((b) => (
							<Row key={b} icon={<BanIcon className="size-4" />}>
								No {b.charAt(0).toLowerCase() + b.slice(1)}
							</Row>
						))}
					</>
				)}
			</Group>

			{rules.allowed && (
				<Group label="Your instructions">
					<Instructions saved={prefs.instructions} onSave={(instructions) => onPrefs({ instructions })} />
					{onRemake && (
						<>
							<button
								type="button"
								data-testid="cheat-sheet-remake"
								disabled={busy}
								onClick={onRemake}
								className="lh-press mt-1 bg-tone px-2.5 py-2 text-left text-[13px] font-bold text-ink hover:bg-tone-2 disabled:opacity-60"
							>
								Remake sheet
							</button>
							<p className="text-[12.5px] text-ink-3">Uses your instructions and choices. Pinned blocks stay.</p>
						</>
					)}
				</Group>
			)}

			<Group label="What goes on it">
				{CHEAT_SHEET_CONTENT.map((c) => {
					const off = banned.has(c.id);
					const on = !off && prefs.content.includes(c.id);
					return (
						<label key={c.id} className={cn("flex items-center gap-3 py-[3px] text-[14.5px]", off ? "text-ink-3" : "cursor-pointer text-ink")}>
							<input
								type="checkbox"
								className="peer sr-only"
								checked={on}
								disabled={off}
								onChange={() => onPrefs({ content: on ? prefs.content.filter((x) => x !== c.id) : [...prefs.content, c.id] })}
							/>
							<span
								aria-hidden
								className={cn(
									"flex size-[17px] shrink-0 items-center justify-center outline outline-1 -outline-offset-1 peer-focus-visible:ring-2 peer-focus-visible:ring-ink",
									on ? "bg-ink text-background outline-ink" : "outline-edge",
								)}
							>
								{on && <CheckIcon className="size-3" strokeWidth={3} />}
							</span>
							<span className="flex-1">{c.label}</span>
							{off && <span className="text-[12px] text-ink-3">not allowed</span>}
						</label>
					);
				})}
			</Group>

			<Group label="Text size">
				<Segmented
					wide
					label="Text size"
					value={prefs.textSize}
					options={(Object.keys(TEXT_SIZES) as CheatSheetTextSize[]).map((id) => ({ id, label: TEXT_SIZES[id].label }))}
					onPick={(textSize) => onPrefs({ textSize })}
				/>
			</Group>
			<Group label="Columns">
				<Segmented
					wide
					label="Columns"
					value={prefs.columns}
					options={[
						{ id: 2, label: "2" },
						{ id: 3, label: "3" },
					]}
					onPick={(columns) => onPrefs({ columns })}
				/>
			</Group>
			<Group label="Ink">
				<Segmented
					wide
					label="Ink"
					value={prefs.ink}
					options={[
						{ id: "black", label: "Black" },
						{ id: "color", label: "Color" },
					]}
					onPick={(ink) => onPrefs({ ink })}
				/>
			</Group>

			<div className="mt-auto flex flex-col gap-2.5 border-t border-tone-2 pt-5">
				<p className="text-[13px] font-bold text-ink-2">{leftOut.length > 0 && !knownCold ? "Left out" : "Left out: you know it"}</p>
				{leftOut.length === 0 ? (
					<p className="text-[13.5px] text-ink-3">Nothing right now</p>
				) : (
					leftOut.map((t) => (
						<div key={t.id} data-testid="cheat-sheet-left-out" className="flex items-center gap-2.5 text-[13.5px] text-ink">
							<span className="size-2.5 shrink-0" style={{ background: STATUS_COLOR[t.status] }} aria-hidden />
							<span className="min-w-0 flex-1 truncate">{t.name}</span>
							<button type="button" disabled={busy} onClick={() => onAdd(t.id)} className="lh-press text-[13px] font-bold text-ink-2 hover:text-ink disabled:opacity-60">
								Add
							</button>
						</div>
					))
				)}
			</div>
		</aside>
	);
}

/** The learner's own words for the agent, saved when the field is left. */
function Instructions({ saved, onSave }: { saved: string; onSave: (text: string) => void }) {
	const [text, setText] = useState(saved);
	useEffect(() => setText(saved), [saved]);
	return (
		<textarea
			data-testid="cheat-sheet-rail-instructions"
			aria-label="Your instructions"
			rows={4}
			maxLength={INSTRUCTIONS_MAX}
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={() => {
				if (text.trim() !== saved) onSave(text.trim());
			}}
			placeholder={INSTRUCTIONS_PLACEHOLDER}
			className="resize-none border border-edge bg-background px-3 py-2 text-[13.5px] leading-5 text-ink outline-none placeholder:text-ink-3 focus:border-ink"
		/>
	);
}

function Group({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section aria-label={label} className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<h2 className="text-[13px] font-bold text-ink-2">{label}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<p className="flex items-center gap-3 py-[3px] text-[14.5px] text-ink">
			<span className="text-ink-2" aria-hidden>
				{icon}
			</span>
			{children}
		</p>
	);
}
