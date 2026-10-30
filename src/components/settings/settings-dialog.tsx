/**
 * THE SETTINGS DIALOG: a centered modal over everything, left section nav
 * + one scrolling content column.
 *
 * - Dialog, not a page: opens over whatever screen you're on (the payoff:
 *   appearance edits restyle the chat LIVE behind the dialog). Escape,
 *   backdrop, and ✕ all close. Modal-only — /settings redirects, so
 *   nothing links into a dead surface.
 * - Left section nav: 920×720,
 *   "Settings" over icon + name rows (the open one lit), the section's
 *   title and ✕ over the scrolling content.
 * - The dialog is surface-agnostic by construction: the sections talk to
 *   /api/settings* and localStorage only, so this shell can be re-mounted
 *   as a true OS window with near-zero churn.
 *
 * One record instance for the whole dialog, sections write through the
 * single `write` seam, switching sections never refetches.
 */

import {
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import {
	CURRENT_SETTINGS_VERSION,
	DEFAULT_TEACHER_NAME,
	type AppearanceSettings,
	type UserSettings,
} from "@/core";
import { useAppearance } from "./appearance.tsx";
import { SettingsSection } from "./controls.tsx";
import { TeachingSection } from "./teaching-section.tsx";
import { GeneralSection } from "./general-section.tsx";
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from "@/components/menu-shell";
import { notifySettingsSaved } from "@/components/settings-signal";
import { Hint } from "@/components/ui/hint";
import { Tip } from "@/components/ui/tooltip";
import { GraduationCapIcon, InfoIcon, KeyboardIcon, PaletteIcon, PlugIcon, SettingsIcon, XIcon } from "lucide-react";
import { AppearanceSection } from "./appearance-section.tsx";
import { KeyboardSection } from "./keyboard-section.tsx";
import { CONNECTION_SECTION_HINT, ConnectionSection } from "./connection-section.tsx";

/** The left nav.
 *  A section's hint shows as a tooltip on the info icon by its title. */
const SECTIONS = [
	{ id: "connection", label: "Connection", icon: PlugIcon, hint: CONNECTION_SECTION_HINT },
	{ id: "teaching", label: "Teaching", icon: GraduationCapIcon },
	{ id: "appearance", label: "Appearance", icon: PaletteIcon },
	{ id: "keyboard", label: "Keyboard", icon: KeyboardIcon, hint: "Stored on this device" },
	{ id: "general", label: "General", icon: SettingsIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const DEFAULT_SECTION: SectionId = "connection";

/** A requested section id → the section that shows it (unknown ids land
 *  on the default). */
export function sectionFor(id: string | undefined): SectionId {
	return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : DEFAULT_SECTION;
}

/** The modal (portal + backdrop + body). Loaded on demand by
 *  settings-dialog-provider.tsx: this module and
 *  every section stay out of each page's startup code. `section` is the
 *  requested id; sectionFor resolves it. */
export function SettingsDialog({
	open,
	onClose,
	section,
}: {
	open: boolean;
	onClose: () => void;
	section: string | undefined;
}) {
	const initialSection = sectionFor(section);
	const backdropDismiss = useBackdropDismiss(onClose);
	// Exit motion: mounted through its fade-out.
	const presence = usePresence(open);
	if (!presence.mounted) return null;
	// Plain dim backdrop (no blur — nothing decorative); a genuine
	// backdrop click closes, the dialog body stops propagation.
	return createPortal(
		<div
			className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70"
			data-testid="settings-backdrop"
			data-state={presence.state}
			inert={!open}
			{...backdropDismiss}
		>
			<SettingsDialogBody onClose={onClose} initialSection={initialSection} state={presence.state} />
		</div>,
		document.body,
	);
}

/** The dialog without the portal/backdrop — the SSR-testable frame
 *  (portals render nothing under renderToStaticMarkup). */
export function SettingsDialogBody({
	onClose,
	initialSection = DEFAULT_SECTION,
	state = "open",
}: {
	onClose: () => void;
	initialSection?: SectionId;
	/** "closed" while the exit plays — Esc is free. */
	state?: "open" | "closed";
}) {
	const { onAppearanceChange } = useAppearance();
	const [record, setRecord] = useState<UserSettings | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);
	// MenuShell open-count — drives the content column's scroll lock.
	const [openMenus, setOpenMenus] = useState(0);
	const contentRef = useRef<HTMLDivElement | null>(null);
	// Scroll-lock (the scrollbar MAY stay, scrolling must NOT happen,
	// nothing may move): the content column
	// keeps overflow-y-auto — the scrollbar and every width stay exactly
	// as they are — and while any MenuShell is open, non-passive wheel +
	// touchmove listeners on the column preventDefault. React attaches
	// synthetic wheel/touch passively at the root, so this needs the
	// native-listener ref seam.
	useEffect(() => {
		const el = contentRef.current;
		if (!el || openMenus === 0) return;
		const block = (e: Event) => e.preventDefault();
		el.addEventListener("wheel", block, { passive: false });
		el.addEventListener("touchmove", block, { passive: false });
		return () => {
			el.removeEventListener("wheel", block);
			el.removeEventListener("touchmove", block);
		};
	}, [openMenus]);

	useEffect(() => {
		const onOpen = () => setOpenMenus((n) => n + 1);
		const onClose = () => setOpenMenus((n) => Math.max(0, n - 1));
		window.addEventListener(MENU_OPEN_EVENT, onOpen);
		window.addEventListener(MENU_CLOSE_EVENT, onClose);
		return () => {
			window.removeEventListener(MENU_OPEN_EVENT, onOpen);
			window.removeEventListener(MENU_CLOSE_EVENT, onClose);
		};
	}, []);
	const [active, setActive] = useState<SectionId>(initialSection);
	const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
	// A deep-link fired while the dialog is ALREADY open changes
	// initialSection under our feet — follow it, or the link silently does
	// nothing.
	useEffect(() => {
		setActive(initialSection);
	}, [initialSection]);

	// Fetch once per dialog mount. 200 {settings: null} is FIRST BOOT
	// (no record = factory everything), not a failure — the error state is
	// a non-200 or a network throw only.
	useEffect(() => {
		fetch("/api/settings")
			.then((r) =>
				r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)),
			)
			.then((body: { settings: UserSettings | null }) =>
				setRecord(body.settings ?? { version: CURRENT_SETTINGS_VERSION }),
			)
			.catch(() => setRecord(null));
	}, []);

	// Escape closes — the layered-dismiss convention (Esc is dead for the
	// sections' own editors while they hold focus; this listener is the
	// dialog's outer layer).
	useEffect(() => {
		if (state === "closed") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// THE ONE-ESC LAW: claim
				// at the document level — the window chain (abort) must
				// not also act. One Esc, one action.
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, state]);

	/** ONE writer for the whole dialog: PUT the whole section, keep the
	 *  record mirror in sync, surface route errors inline (a 400 is a
	 *  schema mistake caught by the validation surface). */
	const write = useCallback(
		async (
			section: "general" | "agent" | "appearance" | "graph" | "compaction",
			body: object,
		) => {
			setError(null);
			let res: Response;
			try {
				res = await fetch(`/api/settings/${section}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
			} catch {
				setError("Network error. Try again.");
				return;
			}
			if (!res.ok) {
				const detail = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				setError(`${section}: ${detail.error ?? res.status}`);
				return;
			}
			// Server truth, never the request body: the route may heal what
			// it stores (orphaned prompt switches), and the writing surface
			// must show the stored value in this same interaction.
			const stored = (
				(await res.json().catch(() => null)) as { settings?: UserSettings } | null
			)?.settings;
			setRecord(
				(prev) =>
					stored ?? ({ ...(prev ?? {}), [section]: body }) as UserSettings,
			);
			notifySettingsSaved(section);
			if (section === "appearance")
				onAppearanceChange(body as AppearanceSettings);
		},
		[onAppearanceChange],
	);

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Settings"
			data-testid="settings-dialog"
			data-state={state}
			className="lh-dialog relative flex h-[720px] max-h-[90vh] w-[920px] max-w-[90vw] overflow-hidden bg-panel shadow-[0_0_40px_#000000e6] outline outline-1 -outline-offset-1 outline-tone-2"
			onClick={(e) => e.stopPropagation()}
		>
			{/* Left nav: the title, then one row per section (icon + name;
			    the open one is lit). */}
			<nav
				aria-label="Settings sections"
				data-testid="settings-nav"
				className="flex w-[220px] shrink-0 flex-col gap-0.5 border-r border-tone-2 px-2.5 py-[18px]"
			>
				<h2 className="px-2.5 pb-3 text-base font-bold text-ink">Settings</h2>
				{SECTIONS.map((s) => {
					const Icon = s.icon;
					const on = active === s.id;
					return (
						<button
							key={s.id}
							type="button"
							data-testid={`settings-nav-${s.id}`}
							aria-current={on}
							className={`lh-press flex items-center gap-2.5 px-2.5 py-2 text-left text-[14.5px] ${
								on ? "bg-tone font-bold text-ink" : "text-ink-2 hover:bg-tone hover:text-ink"
							}`}
							onClick={() => setActive(s.id)}
						>
							<Icon className="size-[15px] shrink-0" aria-hidden />
							{s.label}
						</button>
					);
				})}
			</nav>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex shrink-0 items-center justify-between gap-3 px-7 py-[22px]">
					<span className="flex min-w-0 items-center gap-2">
						<h3 data-testid="settings-section-title" className="truncate text-xl font-bold text-ink">
							{current.label}
						</h3>
						{"hint" in current && (
							<Tip title={current.label} body={<span className="text-xs text-ink-2">{current.hint}</span>} side="bottom" align="start" className="max-w-80">
								<button type="button" aria-label={`About ${current.label}`} className="text-ink-3 hover:text-ink-2">
									<InfoIcon className="size-[13px]" aria-hidden />
								</button>
							</Tip>
						)}
					</span>
					<Hint label="Close" side="left">
						<button
							type="button"
							aria-label="Close settings"
							data-testid="settings-close"
							className="lh-press flex size-7 items-center justify-center text-ink-2 hover:text-ink"
							onClick={onClose}
						>
							<XIcon className="size-4" aria-hidden />
						</button>
					</Hint>
				</header>

				{/* Content column — one section at a time, this scrolls — and
				    LOCKS while any MenuShell is open (no scrolling with a
				    dropdown down; MenuShell announces
				    open/close, the count keeps overlap honest). The lock
				    intercepts wheel/touch instead of hiding the scrollbar —
				    nothing may shift when the lock engages. */}
				<div
					ref={contentRef}
					className="min-h-0 flex-1 overflow-y-auto px-7 pb-[22px]"
					data-testid="settings-content"
				>
					{error && (
						<p
							role="alert"
							className="mb-4 border border-ans-wrong/40 px-3 py-2 text-xs text-ans-wrong"
							data-testid="settings-error"
						>
							{error}
						</p>
					)}
					{record === undefined ? (
						<p className="text-xs text-ink-3">
							Loading settings…
						</p>
					) : record === null ? (
						<p className="text-xs text-ink-3">
							Settings could not be loaded. Refresh to retry.
						</p>
					) : (
						<div>
							{active === "connection" && (
								<SettingsSection title="Connection" testid="section-connection">
									<ConnectionSection />
								</SettingsSection>
							)}
							{active === "teaching" && (
								<SettingsSection title="Teaching" testid="section-teaching">
									<TeachingSection
										agent={record.agent}
										graph={record.graph}
										teacherName={record.general?.teacherName || DEFAULT_TEACHER_NAME}
										onSectionChange={(next) => void write("agent", next)}
									/>
								</SettingsSection>
							)}
							{active === "appearance" && (
								<SettingsSection title="Appearance" testid="section-appearance">
									<AppearanceSection appearance={record.appearance} onSectionChange={(next) => void write("appearance", next)} />
								</SettingsSection>
							)}
							{active === "keyboard" && (
								<SettingsSection title="Keyboard" testid="section-keyboard">
									<KeyboardSection />
								</SettingsSection>
							)}
							{active === "general" && (
								<SettingsSection title="General" testid="section-general">
									<GeneralSection
										record={record}
										onGeneralChange={(next) => void write("general", next)}
										onCompactionChange={(next) => void write("compaction", next)}
										onGraphChange={(next) => void write("graph", next)}
									/>
								</SettingsSection>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
