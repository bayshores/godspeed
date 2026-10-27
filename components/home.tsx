"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeftIcon, DumbbellIcon } from "lucide-react";
import { GraphView } from "@/components/graph-view";
import { useClasses } from "@/components/class-context";
import { MinimalHome } from "@/components/minimal-home";
import { SetupDialog } from "@/components/setup-dialog";
import { ComposerActions, NodePickerControl } from "@/components/composer-actions";
import { ConnectPill, useNoConnection, useStrongDisconnected } from "@/components/setup-cta";
import { useFieldCycle } from "@/components/field-cycle";
import { SidebarToggle, useRiseOnChange } from "@/components/sidebar";
import { StatsBar } from "@/components/stats-bar";
import type { TurnUsage } from "@/src/core";

/**
 * Home — the knowledge graph is the main view, full-bleed edge to edge
 * (owner, graph-view round 1): the canvas owns the whole column, running
 * under the header and the new-session dock, both of which float over it
 * with no gradient scrims. Sessions live in the toggleable sidebar.
 */
export function Home({
	initialConfigured,
	rendering = true,
}: {
	initialConfigured: boolean;
	/** GRAPH RENDERING off (owner, 2026-10-06): the home's main view is
	 * the chains view, not the canvas. Read server-side per navigation —
	 * changing the setting applies on the next visit home. */
	rendering?: boolean;
}) {
	const router = useRouter();
	const { active: activeClassId } = useClasses();
	const [topic, setTopic] = useState("");
	/* The topic MIRROR: the send reads the ref, kept current at every
	 * write, so a closure never sees a stale draft. */
	const topicRef = useRef("");
	// First-run gate (model-slots wave, owner 2026-09-20): chats cannot
	// start until the user has picked all three slots — no defaults for
	// 33 providers. The dock shows the CTA while unconfigured; submitting
	// a topic opens the setup dialog WITH THE DRAFT PRESERVED (Save
	// stores the slots and the queued message sends).
	const [configured, setConfigured] = useState(initialConfigured);
	// The no-connection truth: no subscription signed in = the pill takes
	// precedence over the models CTA (a connection comes first in the chain).
	const noConnection = useNoConnection();
	// The strong slot's disconnected truth (pre-send guards): a subscription
	// may be connected generally while the STRONG slot's pinned provider is
	// not — the same skip-everything treatment on send.
	const strongDisconnected = useStrongDisconnected();
	const [setupOpen, setSetupOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const topicInputRef = useRef<HTMLTextAreaElement>(null);
	// Tab navigates INTO the topic composer (owner, keyboard round
	// 2026-10-06): the only text field on this surface — and home's
	// composer is its OWN textarea, not the shared Composer component,
	// so the chain is the ref itself (the smoke caught a selector that
	// matched nothing here).
	const cycleTopicField = useCallback(
		(): readonly HTMLElement[] => (topicInputRef.current ? [topicInputRef.current] : []),
		[],
	);
	useFieldCycle(cycleTopicField);
	// Switching class swaps the main view: it rises in once (motion wave,
	// owner 2026-10-26). The view itself stays keyed by class.
	const viewRef = useRef<HTMLElement>(null);
	useRiseOnChange(viewRef, activeClassId);

	/* PRACTICE MODE (owner, 2026-10-04): the graph composer's teach |
	 *  practice switch — practice creates a kind:"practice" session and
	 *  may carry proposition picks from the chain table (the chip above
	 *  the composer opens the picker; the picks seed the opening prompt).
	 *  Not enforcing any input format — the picks are a convenience. */
	const [mode, setMode] = useState<"teach" | "practice">("teach");
	const [practiceProps, setPracticeProps] = useState<{ id: string; name: string; statement: string }[]>([]);
	// Picks belong to one class's graph — switching class clears them.
	useEffect(() => setPracticeProps([]), [activeClassId]);
	const [chainSelectOpen, setChainSelectOpen] = useState(false);
	// The chain table is CONTROLLED off this id set (the lifted pick).
	const pickedIds = useMemo(() => new Set(practiceProps.map((p) => p.id)), [practiceProps]);

	const start = async () => {
		const t = topicRef.current.trim();
		if (!t || busy) return;
		// Unconfigured: the send INTERCEPTS into the setup flow (the draft
		// stays in the textarea; the learner sends it after Save).
		if (!configured) {
			setSetupOpen(true);
			return;
		}
		// The pre-send CONNECTION guards (no-orphan-chats): the models case
		// guards BEFORE creation; the connection cases must too — a
		// refused first send would otherwise leave an orphan error-shell
		// chat in the sidebar (the 503 lands only after POST /api/chats
		// already created the record). Same skip-everything-and-open-setup
		// treatment; the server's 503 gate remains the belt for /chat/[id]
		// sessions.
		if (noConnection || strongDisconnected) {
			setSetupOpen(true);
			return;
		}
		setBusy(true);
		try {
			// The map context (owner, 2026-10-04): picks in EITHER mode ride
			// the CREATION as graphContext — the server writes a
			// graph-context marker as message[0] (a separate custom message
			// before the learner's first user message, propositions + the
			// chains among them); the prompt stays the learner's own words.
			const res = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: t,
					...(mode === "practice" ? { kind: "practice" } : {}),
					...(practiceProps.length > 0 ? { graphContext: { propositions: practiceProps } } : {}),
					// Classes wave: the lesson starts in the active class.
					...(activeClassId ? { classId: activeClassId } : {}),
				}),
			});
			const { id } = (await res.json()) as { id: string };
			// No settings PUT on create (per-session models, owner
			// 2026-09-28): the SERVER stamps the newborn from the strong
			// slot — the same default this surface's model control edits.
			router.push(`/chat/${id}?prompt=${encodeURIComponent(t)}`);
		} catch {
			setBusy(false);
		}
	};

	return (
		<div className="relative h-dvh">
			{/* Window-drag strip (merged chrome, owner 2026-09-17): a dedicated
			    mask element, deliberately FIRST in the DOM. Electron's app-region
			    mask resolves by DOM order — a no-drag element subtracts only drag
			    regions that came EARLIER in the tree — not by z-index, so the
			    header's old inline drag region (after <main>) re-added itself over
			    the graph chrome row's carve-out and the buttons dragged the window.
			    Placed first, every carved control (chrome row, node detail card,
			    the toggle) comes later and subtracts correctly. Pure mask: it
			    never needs to receive events — the mask routes the pixels. */}
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />

			{/* The main view — full-bleed (owner, graph-view round 1): no
			    padding on any side; it runs from the sidebar to the right edge
			    and from the bottom to the top, under everything else. With
			    rendering OFF (graph.rendering, owner 2026-10-06) it is the
			    MINIMAL HOME — a quiet knowledge-base summary + the graph
			    chrome's survivors; data, extraction, and the pick flow are
			    untouched, and the chain table stays behind its button. */}
			<main ref={viewRef} className="absolute inset-0" style={{ animationDuration: "var(--lh-dur-slow)" }}>
				{rendering ? (
					<GraphView
						key={activeClassId ?? "none"}
						chainSelectOpen={chainSelectOpen}
						practiceSelection={pickedIds}
						onPracticeSelectionChange={setPracticeProps}
						onChainSelectClose={() => setChainSelectOpen(false)}
					/>
				) : (
					<MinimalHome
						key={activeClassId ?? "none"}
						chainSelectOpen={chainSelectOpen}
						practiceSelection={pickedIds}
						onPracticeSelectionChange={setPracticeProps}
						onChainSelectClose={() => setChainSelectOpen(false)}
					/>
				)}
			</main>

			{/* Header floats over the graph — pointer-events-none except the
			    toggle, so the canvas stays draggable/hoverable around it. Carries
			    no app-region of its own: the strip's drag comes from the mask
			    div above, and the toggle's lh-no-drag subtracts from it (it is
			    later in the tree, so the subtraction sticks). */}
			<header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto">
					<SidebarToggle />
				</div>
			</header>

			{/* New session — same floating blob as the chat composer, docked
			    OVER the graph (no gradient: the graph runs clean under it to the
			    bottom edge). Matches chat.tsx's DOCK geometry (max-w-[46rem]
			    px-4) so nothing shifts when a session starts (owner). */}
			<div className="pointer-events-none absolute inset-x-0 bottom-0 pb-5">
				<div className="pointer-events-auto mx-auto w-full max-w-[46rem] px-4">
					{/* The pick bar (owner vision, 2026-10-04): the chain
					    table's selection is PERSISTENT — picked
					    propositions show here as a count + Clear in EITHER
					    mode (it survives mode switches; only a practice
					    send consumes it). Practice mode with nothing picked
					    shows the pick HINT so the affordance is discoverable;
					    teaching mode with nothing picked renders nothing. */}
					<ComposerActions
						picker={(practiceProps.length > 0 || mode === "practice") && (
							<NodePickerControl
								count={practiceProps.length}
								onOpen={() => setChainSelectOpen(true)}
								onClear={() => setPracticeProps([])}
							/>
						)}
						setup={noConnection ? (
							<ConnectPill inline onOpen={() => setSetupOpen(true)} />
						) : (
							!configured && (
								<button
									type="button"
									data-testid="setup-cta"
									onClick={() => setSetupOpen(true)}
									className="lh-press rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
								>
									Set up your models
								</button>
							)
						)}
					/>
					<form
						className="flex items-end gap-1.5 rounded-2xl border bg-card p-1.5 shadow-lg"
					onSubmit={(e) => {
						e.preventDefault();
						void start();
					}}
				>
					<textarea
						ref={topicInputRef}
						value={topic}
						onChange={(e) => {
							topicRef.current = e.target.value;
							setTopic(e.target.value);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void start();
							}
						}}
						placeholder={mode === "practice" ? "What do you want to practice?" : "What do you want to learn?"}
						autoFocus
						rows={1}
						className="field-sizing-content lh-input max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
					/>
					{/* No tooltip on the start square — the ↵ glyph is the
					    affordance (owner, subtlety round 2026-09-25). */}
					<button
						type="submit"
						aria-label="Start session"
						disabled={!topic.trim() || busy}
						className="lh-press flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
					>
						<CornerDownLeftIcon className="size-5" />
					</button>
					</form>
					{/* Same as the chat view's under-composer stats bar (owner) — no
					    session yet, so the LEFT side renders nothing (wave 7 sweep)
					    while the RIGHT keeps the strong-slot control (fix wave: the
					    pills write /api/settings/models). */}
					<StatsBar
						turns={[] as TurnUsage[]}
						leadingSlot={
							<div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid="home-mode-switch">
								{(["teach", "practice"] as const).map((m) => (
									<button
										key={m}
										type="button"
										data-testid={`home-mode-${m}`}
										onClick={() => setMode(m)}
										className={
											"lh-press flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold " +
											(mode === m
												? "bg-accent text-foreground"
												: "text-muted-foreground hover:text-foreground")
										}
									>
										{m === "practice" ? <DumbbellIcon aria-hidden="true" className="size-3" /> : null}
										{m === "teach" ? "Teach" : "Practice"}
									</button>
								))}
							</div>
						}
					/>
				</div>
			</div>

			{/* First-run setup (unconfigured): the CTA's target and the send
			    interception's landing surface — stage 1 is the self-contained
			    connect screen; Save never sends — the
			    draft stays for the learner to send (owner 2026-10-09). */}
			<SetupDialog
				open={setupOpen}
				onClose={() => setSetupOpen(false)}
				onDone={() => {
					setConfigured(true);
					setSetupOpen(false);
					// Save only saves: the draft waits in the composer.
				}}
				/>
		</div>
	);
}
