/**
 * Thin settings primitives (settings-app wave; restyled 2026-10-27 to
 * docs/design/exports/settings.html): the control kit the settings dialog
 * needs. Sections → groups → rows; everything SSRs clean (render tests
 * pin the sections' markup).
 *
 * The dependency graying (owner, 2026-09-20) follows the graph viewer's
 * render-panel convention: the WHOLE row dims (opacity-40, label and
 * control together) and the control itself locks — the row owns the dim.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

/** A section block (redesign 2026-10-27): the dialog's head shows the
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

/** A labeled sub-group inside a section (docs/design/exports/settings.html:
 *  "Access", "Setup" — a bold muted label over 2px-spaced rows). */
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
	/** Dependency graying, graph-view style: the whole row dims when the
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
	/** Optional icon disc (owner round, 2026-10-07): the figure cards' invert
	 *  toggle renders the half-filled contrast circle AS the disc — the icon
	 *  carries the meaning; plain toggles keep the plain disc. */
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
				// lh-press eases the track colors and dips on press (motion wave,
				// owner 2026-10-26); the disc below slides on the same clock.
				"lh-press relative h-[18px] w-[34px] shrink-0",
				// Redesign 2026-10-27 (docs/design/exports/settings.html): on is a white
				// track with a black knob; off is the tone-2 track.
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
						checked ? "translate-x-[18px] text-black" : "translate-x-0.5 text-ink-3",
					)}
				>
					{discIcon}
				</span>
			) : (
				<span
					className={cn(
						"absolute left-0 top-0.5 size-3.5 transition-[translate,transform,color,background-color] duration-(--lh-dur) ease-(--lh-ease-out) motion-reduce:transition-none",
						// 2px inset from each inner edge, both states.
						checked ? "translate-x-[18px] bg-black" : "translate-x-0.5 bg-ink-3",
					)}
				/>
			)}
		</button>
	);
}

/** A thin select — native element, options as given. */
export function ThinSelect({
	value,
	onChange,
	children,
	ariaLabel,
	testid,
	disabled,
}: {
	value: string;
	onChange: (next: string) => void;
	children: React.ReactNode;
	ariaLabel: string;
	testid?: string;
	disabled?: boolean;
}) {
	return (
		<select
			value={value}
			aria-label={ariaLabel}
			data-testid={testid}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			className={cn(
				"h-7 bg-black px-1.5 font-ui text-[13px] text-ink border border-tone-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) focus-visible:border-ink-3",
				disabled && "cursor-not-allowed",
			)}
		>
			{children}
		</select>
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
	/** "" = unset (the factory default). Mirrors the STORED record —
	 *  after a clamped/normalized commit this flows back and the field
	 *  snaps to the stored truth (owner repro: a negative size kept
	 *  displaying "-5" while 12 was stored). */
	value: string;
	placeholder?: string;
	onCommit: (next: string) => void;
	ariaLabel: string;
	testid?: string;
	type?: "text" | "number";
}) {
	// The draft exists only while editing; a blur shows the record's value
	// again — commit-on-blur/Enter (owner ruling), the field honest about
	// what landed.
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
			className="h-7 w-40 bg-black px-2 font-ui text-[13px] text-ink border border-tone-2 transition-colors duration-(--lh-dur) ease-(--lh-ease-out) placeholder:text-ink-3 focus-visible:border-ink-3"
		/>
	);
}
/** The settings' small outlined button ("Copy", "New token"). */
export const OUTLINE_BUTTON =
	"lh-press shrink-0 px-2.5 py-[5px] text-[13px] font-bold text-ink border border-tone-2 hover:bg-tone-2 focus-visible:border-ink-3 disabled:opacity-50";
