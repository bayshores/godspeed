/**
 * Settings → Appearance:
 * background presets on top, the type controls on the left and a live
 * lesson preview on the right. The preview uses the real lesson styles,
 * so every saved change shows in it (and in the app behind the page).
 */

import { useEffect, useRef, useState } from "react";
import type { AppearanceSettings } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { cn } from "@/frontend/lib/utils";
import { useAppearance } from "./appearance.tsx";
import { BACKGROUND_PRESETS, HEADING_WEIGHTS, INK_PRESETS, PAPER, derivedPalette, readableBackground } from "./appearance-model.ts";
import { DEFAULT_READING_FONT, FontMenuList } from "./font-menu";
import { Slider } from "./controls.tsx";
import { RULE } from "@/frontend/components/deadline/styles";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** Offered when the installed list can't be read (a plain browser). */
export const CURATED_FALLBACK_FONTS: readonly string[] = [
	"Arial",
	"CMU Serif",
	"Courier New",
	"Georgia",
	"Helvetica",
	"Helvetica Neue",
	"Menlo",
	"Times New Roman",
	"Trebuchet MS",
	"Verdana",
];

/** null or blank = the factory font; otherwise the family, trimmed. */
export function composeFontFamily(appearance: AppearanceSettings | undefined, family: string | null): AppearanceSettings {
	const value = family?.trim() ?? "";
	return { ...appearance, fontFamily: value === "" ? null : value };
}

export function AppearanceSection({
	appearance,
	onSectionChange,
}: {
	/** The record's appearance delta (absent = factory). */
	appearance: AppearanceSettings | undefined;
	/** PUT the whole appearance section; the provider re-applies on success. */
	onSectionChange: (next: AppearanceSettings) => void;
}) {
	const { appearance: resolved } = useAppearance();
	const md = appearance?.mdRendering;
	const background = appearance?.background ?? null;
	const shownBackground = background ?? PAPER;
	const isPreset = BACKGROUND_PRESETS.some((p) => p.color === background);
	const weightIndex = Math.max(0, HEADING_WEIGHTS.findIndex((w) => w.weight >= resolved.mdRendering.headingWeight));
	const ink = md?.boldColor ?? null;
	const customInk = ink !== null && !INK_PRESETS.includes(ink);
	const setInk = (color: string | null) =>
		onSectionChange({ ...appearance, mdRendering: { ...md, boldColor: color, italicColor: color } });

	return (
		<div className="flex flex-col gap-5">
			<Pane data-testid="group-background" className="flex flex-col gap-3.5 px-6 py-[18px]">
				<h2 className="text-xl leading-tight text-ink">Background</h2>
				<div className="grid grid-cols-7 gap-2.5">
					{BACKGROUND_PRESETS.map((preset) => (
						<ThemeTile
							key={preset.name}
							name={preset.name}
							color={preset.color ?? PAPER}
							on={preset.color === background}
							onPick={() => onSectionChange({ ...appearance, background: preset.color })}
						/>
					))}
					<label className="lh-press flex cursor-pointer flex-col items-center gap-1.5" data-testid="theme-custom">
						<span
							className={cn(
								"relative flex h-16 w-full items-center justify-center rounded-[3px] border bg-background",
								!isPreset ? "border-2 border-ink" : "border-edge",
							)}
							style={!isPreset && background ? { background: readableBackground(background) } : undefined}
						>
							<span className="flex size-[26px] items-center justify-center bg-background text-ink">
								<PixelIcon name="plus" className="h-3.5" />
							</span>
							<ColorInput label="Custom background color" value={shownBackground} onCommit={(c) => onSectionChange({ ...appearance, background: c })} />
						</span>
						<span className={cn("text-sm text-ink", !isPreset && "font-medium")}>Custom</span>
					</label>
				</div>
			</Pane>

			<div className="flex items-start gap-5">
				<Pane className="flex w-[340px] shrink-0 flex-col gap-[18px] px-6 py-5">
					<Control label="Reading font">
						<FontPicker family={appearance?.fontFamily ?? null} onPick={(family) => onSectionChange(composeFontFamily(appearance, family))} />
					</Control>
					<Control label="Text size">
						<Slider
							value={resolved.proseFontSize}
							min={12}
							max={24}
							ariaLabel="Text size"
							testid="slider-text-size"
							label={(v) => `${v} px`}
							onCommit={(v) => onSectionChange({ ...appearance, proseFontSize: v })}
						/>
					</Control>
					<Control label="Heading weight">
						<Slider
							value={weightIndex}
							min={0}
							max={HEADING_WEIGHTS.length - 1}
							ariaLabel="Heading weight"
							testid="slider-heading-weight"
							label={(i) => HEADING_WEIGHTS[i]?.name ?? ""}
							onCommit={(i) => onSectionChange({ ...appearance, mdRendering: { ...md, headingWeight: HEADING_WEIGHTS[i]?.weight } })}
						/>
					</Control>
					<Control label="Bold and italic color">
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								aria-pressed={ink === null}
								onClick={() => setInk(null)}
								className={cn("lh-press h-7 rounded-[3px] border-[1.5px] border-ink px-2.5 text-sm", ink === null ? "bg-tint text-background" : "text-ink hover:bg-tone")}
							>
								Same as text
							</button>
							{INK_PRESETS.map((c) => (
								<InkSwatch key={c} color={c} on={ink === c} onPick={() => setInk(c)} />
							))}
							<label
								className={cn(
									"lh-press relative flex size-7 cursor-pointer items-center justify-center rounded-[3px] border bg-background text-ink",
									customInk ? "border-2 border-ink" : "border-edge",
								)}
								style={customInk ? { background: ink } : undefined}
							>
								<PixelIcon name="plus" className="h-[10.5px]" />
								<ColorInput label="Custom bold and italic color" value={ink ?? "#ffffff"} onCommit={setInk} />
							</label>
						</div>
					</Control>
				</Pane>
				<Preview />
			</div>
		</div>
	);
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<p className="text-lg font-medium text-ink">{label}</p>
			{children}
		</div>
	);
}

function ThemeTile({ name, color, on, onPick }: { name: string; color: string; on: boolean; onPick: () => void }) {
	const p = derivedPalette(color);
	return (
		<button type="button" aria-pressed={on} data-testid={`theme-${name.toLowerCase()}`} onClick={onPick} className="lh-press flex flex-col items-center gap-1.5">
			<span
				className={cn("flex h-16 w-full flex-col gap-1.5 rounded-[3px] p-2.5", on ? "border-2 border-ink" : "border")}
				style={{ background: color, borderColor: on ? undefined : p["--border"] }}
			>
				<span className="h-[5px] w-10" style={{ background: p["--foreground"] }} />
				<span className="h-[3px] w-[70px] max-w-full" style={{ background: p["--foreground"] }} />
				<span className="h-[3px] w-[54px] max-w-full" style={{ background: p["--foreground"] }} />
			</span>
			<span className={cn("text-sm text-ink", on && "font-medium")}>{name}</span>
		</button>
	);
}

/** The system color picker, invisible over its tile. Saves once the pick
 *  is done (the native change event), not on every drag step. */
function ColorInput({ label, value, onCommit }: { label: string; value: string; onCommit: (color: string) => void }) {
	return (
		<input
			type="color"
			aria-label={label}
			defaultValue={value}
			ref={(el) => {
				if (el) el.onchange = () => onCommit(el.value);
			}}
			className="absolute inset-0 cursor-pointer opacity-0"
		/>
	);
}

function InkSwatch({ color, on, onPick }: { color: string; on: boolean; onPick: () => void }) {
	return (
		<button
			type="button"
			aria-label={color}
			aria-pressed={on}
			onClick={onPick}
			className={cn("lh-press size-7 rounded-[3px] border border-edge", on && "outline-2 outline-offset-2 outline-ink")}
			style={{ background: color, outlineStyle: on ? "solid" : undefined }}
		/>
	);
}

/** The sample lesson, drawn with the real lesson styles. */
function Preview() {
	return (
		<Pane data-testid="appearance-preview" className="flex min-w-0 flex-1 flex-col gap-3 px-7 py-5">
			<h2 className="text-xl leading-tight text-ink">Preview</h2>
			<div className={RULE} />
			<div className="lh-prose flex flex-col gap-2.5">
				<h4 className="text-[1.4em]">Why a derivative is a slope</h4>
				<p>
					Zoom in on a smooth curve and it <strong>looks straight</strong>.
				</p>
				<p>
					That line&apos;s slope <em>is</em> the derivative at the point.
				</p>
				<h4 className="text-[1.1em]">Picking the line</h4>
				<p>Take two points and slide one toward the other.</p>
			</div>
		</Pane>
	);
}

/** The reading-font menu trigger. The installed families load on the
 *  first open (desktop app); a plain browser gets a short common list. */
function FontPicker({ family, onPick }: { family: string | null; onPick: (family: string | null) => void }) {
	const [open, setOpen] = useState(false);
	const [fonts, setFonts] = useState<string[] | null | undefined>(undefined);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const toggle = () => {
		if (!open && fonts === undefined) {
			const list = typeof window === "undefined" ? undefined : window.lh?.listFonts;
			if (!list) setFonts(null);
			else
				void list()
					.then((all) => setFonts(all.length ? all.filter((f) => f !== DEFAULT_READING_FONT) : null))
					.catch(() => setFonts(null));
		}
		setOpen((o) => !o);
	};

	// Any click outside the open menu, or Escape, closes it (not the dialog).
	// Escape returns focus to the trigger, as every menu does (useMenuDismiss).
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (anchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [open]);

	return (
		<span ref={anchorRef} className="relative block">
			<button
				ref={triggerRef}
				type="button"
				aria-label="Reading font"
				aria-expanded={open}
				data-testid="font-trigger"
				onClick={toggle}
				className="lh-press flex h-10 w-full items-center justify-between gap-2.5 rounded border-[1.5px] border-ink bg-panel px-3 text-left text-[15px] font-medium text-ink hover:bg-tone"
			>
				<span className="min-w-0 truncate" style={{ fontFamily: family ? `"${family}"` : undefined }}>
					{family || DEFAULT_READING_FONT}
				</span>
				<PixelIcon name="chevron" className="h-[10.5px] rotate-90" />
			</button>
			<MenuShell
				open={open}
				preferredSide="down"
				anchorTestid="font-trigger"
				testid="font-menu"
				role="dialog"
				label="Reading font"
				menuClass="lh-popup flex w-[18rem] flex-col p-1.5"
			>
				<FontMenuList
					families={fonts === undefined ? undefined : (fonts ?? [...CURATED_FALLBACK_FONTS])}
					effectiveFamily={family}
					onPick={(f) => {
						setOpen(false);
						onPick(f);
					}}
					footer={fonts === undefined ? undefined : fonts === null ? "Common fonts. Your installed fonts show in the desktop app." : "Your installed fonts"}
				/>
			</MenuShell>
		</span>
	);
}
