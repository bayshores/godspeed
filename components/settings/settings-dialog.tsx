/**
 * THE SETTINGS DIALOG (settings-app wave, 2026-09-20): the thin settings
 * page graduated into the designed surface — a centered modal over
 * everything, left section nav + one scrolling content column.
 *
 * Owner decisions this wave:
 * - Dialog, not a page: opens over whatever screen you're on (the payoff:
 *   appearance edits restyle the chat LIVE behind the dialog). Escape,
 *   backdrop, and ✕ all close. Modal-only — /settings redirects, so
 *   nothing links into a dead surface.
 * - Left section nav (restyled 2026-10-27 to design/exports/settings.html):
 *   920×720, "Settings" over icon + name rows (the open one lit), the
 *   section's title and ✕ over the scrolling content.
 * - The dialog is surface-agnostic by construction: the sections talk to
 *   /api/settings* and localStorage only, so this shell can be re-mounted
 *   as a true OS window in the Electron round with near-zero churn.
 *
 * The record + the single `write` seam moved here from the thin page:
 * one record instance for the whole dialog, sections write through it,
 * switching sections never refetches.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import {
	CURRENT_SETTINGS_VERSION,
	type AgentSettings,
	type AppearanceSettings,
	type CompactionSettings,
	type GraphSettings,
	type UserSettings,
} from "@/src/core";
import { useAppearance } from "./appearance.tsx";
import { SettingsGroup, SettingsSection } from "./controls.tsx";
import { UpdateSettings } from "./update-settings.tsx";
import { AgentSection } from "./agent-section.tsx";
import type { ModelsSettings } from "@/src/core";
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from "@/components/menu-shell";
import { notifySettingsSaved } from "@/components/settings-signal";
import { Hint } from "@/components/ui/hint";
import { Tip } from "@/components/ui/tooltip";
import { BotIcon, InfoIcon, KeyRoundIcon, KeyboardIcon, PaletteIcon, PlugIcon, SettingsIcon, XIcon } from "lucide-react";
import { AppearanceSection, GraphSection } from "./appearance-section.tsx";
import { KeyboardSection } from "./keyboard-section.tsx";
import { AGENTS_SECTION_HINT, AgentsSection } from "./agents-section.tsx";
import { ChatGPTUIProvider } from "./chatgpt-connection.tsx";
import { NativeSubscriptionUIProvider, SubscriptionConnections } from "./subscription-connections.tsx";

/** The left nav, in the redesign's order (design/exports/settings.html).
 *  A section's hint shows as a tooltip on the info icon by its title.
 *  The old Graph section's rows live in General now. */
const SECTIONS = [
	{ id: "agents", label: "Outside agents", icon: PlugIcon, hint: AGENTS_SECTION_HINT },
	{ id: "agent", label: "Agent", icon: BotIcon },
	{ id: "providers", label: "Providers", icon: KeyRoundIcon },
	{ id: "appearance", label: "Appearance", icon: PaletteIcon },
	{ id: "keyboard", label: "Keyboard", icon: KeyboardIcon, hint: "Stored on this device" },
	{ id: "general", label: "General", icon: SettingsIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const DEFAULT_SECTION: SectionId = "agents";

/** A requested section id → the section that shows it ("graph" moved
 *  into General; unknown ids land on the default). */
export function sectionFor(id: string | undefined): SectionId {
	if (id === "graph") return "general";
	return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : DEFAULT_SECTION;
}

/** `open(section?)` — lands the dialog on a section (default Outside agents). */
const DialogContext = createContext<{ open: (section?: string) => void }>({ open: () => {} });

/** AppShell-level mount: the sidebar row and the mod+, chord call this.
 *  `open(section)` lands the dialog on a specific section. */
export function SettingsDialogProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [show, setShow] = useState(false);
	const [landOn, setLandOn] = useState<SectionId>(DEFAULT_SECTION);
	const open = useCallback((section?: string) => {
		setLandOn(sectionFor(section));
		setShow(true);
	}, []);
	useEffect(() => window.lh?.onOpenSettings?.((section) => open(section)), [open]);
	return (
		<ChatGPTUIProvider><NativeSubscriptionUIProvider><DialogContext.Provider value={{ open }}>
			{children}
			{/* Rendered always; `open` lets it fade out (motion wave). */}
			<SettingsDialog open={show} onClose={() => setShow(false)} initialSection={landOn} />
		</DialogContext.Provider></NativeSubscriptionUIProvider></ChatGPTUIProvider>
	);
}

export function useSettingsDialog() {
	return useContext(DialogContext);
}

function SettingsDialog({
	open,
	onClose,
	initialSection,
}: {
	open: boolean;
	onClose: () => void;
	initialSection: SectionId;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	// Exit motion (motion wave, owner 2026-10-26): mounted through its fade-out.
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
	/** Motion (motion wave): "closed" while the exit plays — Esc is free. */
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
	// Scroll-lock (fix wave, owner ruling: the scrollbar MAY stay,
	// scrolling must NOT happen, nothing may move): the content column
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
	// A deep-link fired while the dialog is ALREADY open (first exercised by
	// the wave-6 embedding picker's "Add a provider key first…" link — the
	// picker itself died with wave 7, the mechanism is general) changes
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
				// THE ONE-ESC LAW (owner, keyboard round 2026-10-06): claim
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
			section: "general" | "agent" | "models" | "appearance" | "graph" | "compaction",
			body: object,
		) => {
			setError(null);
			const res = await fetch(`/api/settings/${section}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const detail = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				setError(`${section}: ${detail.error ?? res.status}`);
				return;
			}
			// Server truth, never the request body (fix wave, owner repro):
			// the models section clamps pinned thinking levels on write
			// (bd68486) — a swap that rides an unsupported level lands
			// CLAMPED in the record, and the writing surface must show the
			// stored value in this same interaction, not the optimistic one.
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
			className="lh-dialog flex h-[720px] max-h-[90vh] w-[920px] max-w-[90vw] overflow-hidden bg-panel shadow-[0_0_40px_#000000e6] outline outline-1 -outline-offset-1 outline-tone-2"
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
					<Hint
						// Esc closes the dialog (its own listener) — surface it.
						label="Close"
						binding="escape"
						side="left"
					>
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
				    LOCKS while any MenuShell is open (owner ruling: no
				    scrolling with a dropdown down; MenuShell announces
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
							Settings could not be loaded — refresh to retry.
						</p>
					) : (
						<div>
							{active === "general" && (
								<SettingsSection
									title="General"
									testid="section-general"
								>
									<UpdateSettings
										autoUpdate={record.general?.autoUpdate ?? true}
										onAutoUpdateChange={(on) =>
											void write("general", { ...record.general, autoUpdate: on })
										}
									/>
									<SettingsGroup label="Graph" testid="section-graph">
										<GraphSection
											graph={record.graph}
											onSectionChange={(next: GraphSettings) =>
												void write("graph", next)
											}
										/>
									</SettingsGroup>
								</SettingsSection>
							)}
							{active === "providers" && (
								<SettingsSection title="Providers" testid="section-providers">
									<SettingsGroup label="Subscriptions" testid="group-subscriptions">
										<SubscriptionConnections />
									</SettingsGroup>
								</SettingsSection>
							)}
							{active === "agent" && (
								<SettingsSection
									title="Agent"
									testid="section-agent"
								>
									<AgentSection
										agent={record.agent}
										models={record.models}
										graph={record.graph}
										compaction={record.compaction}
										onModelsChange={(next: ModelsSettings) =>
											void write("models", next)
										}
										onSectionChange={(next: AgentSettings) =>
											void write("agent", next)
										}
										onCompactionChange={(next: CompactionSettings) =>
											void write("compaction", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "agents" && (
								<SettingsSection title="Outside agents" testid="section-agents">
									<AgentsSection />
								</SettingsSection>
							)}
							{active === "appearance" && (
								<SettingsSection
									title="Appearance"
									testid="section-appearance"
								>
									<AppearanceSection
										appearance={record.appearance}
										onSectionChange={(next: AppearanceSettings) =>
											void write("appearance", next)
										}
									/>
								</SettingsSection>
							)}
							{active === "keyboard" && (
								<SettingsSection
									title="Keyboard"
									testid="section-keyboard"
								>
									<KeyboardSection />
								</SettingsSection>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
