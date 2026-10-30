/**
 * Thin settings primitives: the control kit the settings dialog
 * needs. Sections → groups → rows; everything SSRs clean (render tests
 * pin the sections' markup).
 *
 * Dependency graying: the WHOLE row dims (label and control together) and
 * the control itself locks; the row owns the dim.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

/** A section block: the dialog's head shows the
 *  section's title, so the block is just its groups and rows. */
export function SettingsSection({
	title,
	children,
	testid,
}: {
	title: string;
	/** Kept for callers; the dialog head shows section hints as a tooltip. */
	hint?: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<section data-testid={testid} aria-label={title} className="flex flex-col gap-0.5">
			{children}
		</section>
	);
}

/** A labeled sub-group inside a section ("Access", "Setup"): a bold muted
 *  label over 2px-spaced rows. */
export function SettingsGroup({
	label,
	children,
	testid,
}: {
	label: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<div data-testid={testid} className="mt-[22px] first:mt-0">
			<p className="pb-2 text-[13px] font-bold text-ink-3">{label}</p>
			<div className="flex flex-col gap-0.5 [&>p]:py-1.5">{children}</div>
		</div>
	);
}

/** One label + one control on a tone row: label left (with an optional
 *  muted hint under it, or a hover tooltip on the label), control right. */
export function SettingsRow({
	label,
	hint,
	tip,
	children,
	testid,
	dimmed,
}: {
	label: string;
	hint?: ReactNode;
	/** An explanation shown when the label is hovered or focused. */
	tip?: ReactNode;
	children: React.ReactNode;
	testid?: string;
	/** Dependency graying: the whole row dims when the
	 *  control is inert (parent off, no file yet, …). */
	dimmed?: boolean;
}) {
	const text = <span className="block text-[14.5px] text-ink">{label}</span>;
	return (
		<div data-testid={testid} className={cn("flex min-h-[46px] items-center justify-between gap-4 bg-tone px-3.5 py-2.5", dimmed && "opacity-40")}>
			<span className="min-w-0">
				{tip ? (
					<Tip title={label} body={<span className="text-xs text-ink-2">{tip}</span>} side="top" align="start" className="max-w-80">
						<span tabIndex={0} className="block w-fit cursor-default text-[14.5px] text-ink outline-none focus-visible:underline focus-visible:underline-offset-4">
							{label}
						</span>
					</Tip>
				) : (
					text
				)}
				{hint && <span className="block text-xs text-ink-3">{hint}</span>}
			</span>
			{children}
		</div>
	);
}

/** The on/off switch — a plain button in the switch role. */
export function Toggle({
	checked,
	disabled,
	onChange,
	label,
	discIcon,
	title,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
	/** Accessible name for the switch role. */
	label: string;
	/** Optional icon disc: the figure cards' invert toggle draws its
	 *  contrast circle AS the disc; plain toggles keep the plain disc. */
	discIcon?: ReactNode;
	/** Optional native tooltip on the switch. */
	title?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			{...(title ? { title } : {})}
			disabled={disabled}
			data-testid={`toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
			onClick={() => onChange(!checked)}
			className={cn(
				// lh-press eases the track colors and dips on press; the disc
				// below slides on the same clock.
				"lh-press relative h-[18px] w-[34px] shrink-0",
				// On is a white track with a black knob; off is the tone-2 track.
				checked ? "bg-ink" : "bg-tone-2",
				disabled && "cursor-not-allowed",
			)}
		>
			{discIcon ? (
				// The icon IS the disc: same size, same slide, same state colors —
				// only the knob's face changes (the invert affordance).
				<span
					className={cn(
						"absolute left-0 top-0.5 flex size-3.5 items-center justify-center transition-[translate,transform,color,background-color] duration-(--lh-dur) ease-(--lh-ease-out) motion-reduce:transition-none",
						checked ? "translate-x-[18px] text-background" : "translate-x-0.5 text-ink-3",
					)}
				>
					{discIcon}
				</span>
			) : (
				<span
					className={cn(
						"absolute left-0 top-0.5 size-3.5 transition-[translate,transform,color,background-color] duration-(--lh-dur) ease-(--lh-ease-out) motion-reduce:transition-none",
						// 2px inset from each inner edge, both states.
						checked ? "translate-x-[18px] bg-background" : "translate-x-0.5 bg-ink-3",
					)}
				/>
			)}
		</button>
	);
}

/** A slider: moves freely, saves when released (every save is a section
 *  PUT). `label` names the current value beside it. */
export function Slider({
	value,
	min,
	max,
	step = 1,
	onCommit,
	label,
	ariaLabel,
	testid,
	disabled,
}: {
	value: number;
	min: number;
	max: number;
	step?: number;
	onCommit: (next: number) => void;
	label: (value: number) => string;
	ariaLabel: string;
	testid?: string;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState<number | null>(null);
	// The draft stays shown until the saved value comes back, so a second
	// drag or key press starts from it, not from the old value.
	const [saved, setSaved] = useState(value);
	if (value !== saved) {
		setSaved(value);
		setDraft(null);
	}
	const shown = draft ?? value;
	const commit = () => {
		if (draft === null) return;
		if (draft === value) setDraft(null);
		else onCommit(draft);
	};
	return (
		<span className="flex w-full items-center gap-3">
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={shown}
				disabled={disabled}
				aria-label={ariaLabel}
				data-testid={testid}
				onChange={(e) => setDraft(Number(e.target.value))}
				onPointerUp={commit}
				onKeyUp={commit}
				onBlur={commit}
				style={{ "--fill": `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
				className="lh-press h-4 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--border)_var(--fill))] [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-ink"
			/>
			<span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-ink-2">{label(shown)}</span>
		</span>
	);
}

/** A thin hex/text input committing on blur + Enter (settings pace, not
 *  typing pace — every commit is a section PUT). */
export function CommitInput({
	value,
	placeholder,
	onCommit,
	ariaLabel,
	testid,
	type = "text",
}: {
	/** "" = unset (the factory default). Mirrors the STORED record, so
	 *  after a clamped commit the field shows what was really saved. */
	value: string;
	placeholder?: string;
	onCommit: (next: string) => void;
	ariaLabel: string;
	testid?: string;
	type?: "text" | "number";
}) {
	// The draft exists only while editing; a blur shows the record's value
	// again, so the field is honest about what landed.
	const [draft, setDraft] = useState(value);
	const [editing, setEditing] = useState(false);
	return (
		<input
			type={type}
			value={editing ? draft : value}
			placeholder={placeholder}
			aria-label={ariaLabel}
			data-testid={testid}
			onChange={(e) => {
				setEditing(true);
				setDraft(e.target.value);
			}}
			onBlur={() => {
				if (!editing) return;
				setEditing(false);
				const next = draft.trim();
				if (next !== value) onCommit(next);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape") {
					setEditing(false);
					e.currentTarget.blur();
				}
			}}
			className="h-7 w-40 bg-background px-2 font-ui text-[13px] text-ink border border-tone-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) placeholder:text-ink-3 focus-visible:border-ink-3"
		/>
	);
}
/** The settings' small outlined button ("Copy", "New token"). */
export const OUTLINE_BUTTON =
	"lh-press shrink-0 px-2.5 py-[5px] text-[13px] font-bold text-ink border border-tone-2 hover:bg-tone-2 focus-visible:border-ink-3 disabled:opacity-50";
