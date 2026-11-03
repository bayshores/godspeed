"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon, PrinterIcon } from "lucide-react";
import {
	PAPERS,
	STATUS_COLOR,
	WATCH_OUT,
	dayLabel,
	fitFixes,
	leftOutTopics,
	overflowLines,
	plannedBlocks,
	sheetContent,
	stackNotes,
	type CheatSheet,
	type CheatSheetPrefs,
	type CheatSheetView,
	type FitFix,
} from "@/core";
import { useAgentStatus } from "@/components/agent-status";
import { useClasses } from "@/components/class-context";
import { LoadFailed } from "@/components/load-failed";
import { useFoldSidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { AskPanel, BlockToolbar } from "./block-tools";
import { Paper, paperGeometry, type PaperItem, type PaperLayout } from "./paper";
import { Rail } from "./rail";
import { SetupDialog } from "./setup-dialog";
import { NoAgent, PaperCard, StudioStatus } from "./studio-states";
import { useCheatSheet } from "./use-cheat-sheet";

/** The margins beside the paper, where each block's reason sits. */
const MARGIN = 250;
const NOTE_HEIGHT = 20;

/**
 * THE CHEAT SHEET STUDIO: a page of its own with the sidebar folded away.
 * The paper sits in the middle at its true proportions, the settings rail
 * on the left, each block's reason in the margin beside it. Click a block
 * for its toolbar and to ask for a change. The top bar says whether it
 * fits (measured on the real paper), and prints it or saves a PDF.
 */
export function CheatSheetStudio({ classId, deadlineId }: { classId: string; deadlineId: string }) {
	useFoldSidebar();
	const router = useRouter();
	const { active, setActive } = useClasses();
	const [joined, setJoined] = useState(active === classId);
	useEffect(() => {
		if (!joined) {
			if (active === classId) setJoined(true);
			else setActive(classId);
		} else if (active !== classId) router.replace("/class");
	}, [active, classId, joined, setActive, router]);

	const { view, loadError, reload, act, save } = useCheatSheet(classId, deadlineId);
	const [setupOpen, setSetupOpen] = useState(false);
	const opened = useRef(false);
	// A sheet whose rules were never confirmed starts with the setup.
	useEffect(() => {
		if (!view || opened.current) return;
		opened.current = true;
		if (!view.sheet.confirmedAt && !view.newer) setSetupOpen(true);
	}, [view]);

	return (
		<div className="flex h-full flex-col">
			{view ? (
				<Studio view={view} deadlineId={deadlineId} act={act} save={save} onEditRules={() => setSetupOpen(true)} />
			) : (
				<>
					<TopBar />
					{loadError ? <LoadFailed message="Couldn't load this cheat sheet." onRetry={() => void reload()} className="px-[52px] py-6" /> : <div className="flex-1" aria-hidden />}
				</>
			)}
			<SetupDialog classId={classId} deadlineId={deadlineId} open={setupOpen} onClose={() => setSetupOpen(false)} />
		</div>
	);
}

function Studio({
	view,
	deadlineId,
	act,
	save,
	onEditRules,
}: {
	view: CheatSheetView;
	deadlineId: string;
	act: (body: Record<string, unknown>) => Promise<string | null>;
	save: (patch: { prefs?: Partial<CheatSheetPrefs> }) => Promise<string | null>;
	onEditRules: () => void;
}) {
	const agent = useAgentStatus();
	const agentName = agent?.name ?? "Your agent";
	// Choices show at once; the saved view catches up.
	const [prefs, setPrefs] = useState<CheatSheetPrefs>(view.sheet.prefs);
	useEffect(() => setPrefs(view.sheet.prefs), [view.sheet.prefs]);
	const sheet: CheatSheet = useMemo(() => ({ ...view.sheet, prefs }), [view.sheet, prefs]);
	const g = useMemo(() => paperGeometry(sheet), [sheet]);
	const [selected, setSelected] = useState<string | null>(null);
	const [layout, setLayout] = useState<PaperLayout | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	const run = view.running;

	const post = useCallback(
		async (body: Record<string, unknown>) => {
			const error = await act(body);
			setFailed(error);
			return error;
		},
		[act],
	);
	const changePrefs = (patch: Partial<CheatSheetPrefs>) => {
		setPrefs((p) => ({ ...p, ...patch }));
		void save({ prefs: patch }).then(setFailed);
	};

	// The paper fits the stage's height (an index card may grow to twice its size).
	const stage = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(0.75);
	useLayoutEffect(() => {
		const el = stage.current;
		if (!el) return;
		const fit = () => setScale(Math.max(0.3, Math.min(2, (el.clientHeight - 56) / g.height, (el.clientWidth - 2 * MARGIN - 72) / g.width)));
		fit();
		const observer = new ResizeObserver(fit);
		observer.observe(el);
		return () => observer.disconnect();
	}, [g.height, g.width]);

	const statusOf = useMemo(() => new Map(view.topics.map((t) => [t.id, t.status])), [view.topics]);
	const withMistakes = sheetContent(sheet).includes("mistakes");
	const planned = useMemo(() => plannedBlocks(view.topics, view.mistakes, withMistakes), [view.topics, view.mistakes, withMistakes]);
	const items: PaperItem[] = useMemo(() => {
		const blocks = view.sheet.blocks;
		const pending = (topicId: string, title: string): PaperItem => ({ id: `plan:${topicId}`, topicId, title, body: "", pending: true });
		if (run?.kind === "make") {
			const pinned = blocks.filter((b) => b.pinned);
			const out: PaperItem[] = planned.map((p) => pinned.find((b) => b.topicId === p.topicId) ?? pending(p.topicId, p.title));
			return [...out, ...pinned.filter((b) => !out.includes(b))];
		}
		if (run?.topicId) {
			const rank = (id: string) => (id === WATCH_OUT ? -1 : view.topics.findIndex((t) => t.id === id));
			const name = view.topics.find((t) => t.id === run.topicId)?.name ?? "";
			const at = blocks.findIndex((b) => rank(b.topicId) > rank(run.topicId!));
			const list: PaperItem[] = [...blocks];
			list.splice(at < 0 ? list.length : at, 0, pending(run.topicId, name));
			return list;
		}
		return blocks;
	}, [view.sheet.blocks, view.topics, run, planned]);
	const busyIds = useMemo(() => new Set(run?.blockIds ?? []), [run]);

	const hasBlocks = view.sheet.blocks.length > 0;
	const agentGone = !!agent && !agent.connected && !agent.teaching;
	const noAgent = agentGone && !hasBlocks;
	const showPaper = view.sheet.rules.allowed && (hasBlocks || run?.kind === "make") && !noAgent;
	const fits = !layout || layout.packing.overflow === 0;
	const overLines = layout ? overflowLines(layout.packing.overflow, layout.lineHeight) : 0;
	const fixes: FitFix[] = showPaper && !fits && !run && layout ? fitFixes(sheet, layout.heights, view.topics) : [];
	// Before anything is on the paper, the plan says what stays off it.
	const leftOut = leftOutTopics(view.topics, items.length ? items : planned);
	const block = view.sheet.blocks.find((b) => b.id === selected) ?? null;
	const spot = layout?.spots.find((s) => s.id === selected) ?? null;
	const colorOf = useCallback((topicId: string) => STATUS_COLOR[topicId === WATCH_OUT ? "weak" : (statusOf.get(topicId) ?? "untested")], [statusOf]);

	const onFix = (fix: FitFix) => {
		if (fix.kind === "tighten") void post({ action: "change", how: "tighten", blockIds: fix.blockIds });
		else if (fix.kind === "small-text") changePrefs({ textSize: "small" });
		else void post({ action: "remove", blockId: fix.blockId });
	};

	// Reasons in the margins: the first column's on the left, the rest on the right.
	const notes = useMemo(() => {
		if (!layout || !showPaper) return { left: [], right: [] };
		const all = layout.spots.flatMap((s) => {
			const b = view.sheet.blocks.find((x) => x.id === s.id);
			if (!b) return [];
			return [{ id: s.id, y: s.y, left: s.column === 0 && !s.over, text: s.over ? "Runs off the page" : `${b.reason}${b.pinned ? " · pinned" : ""}`, over: s.over, color: colorOf(b.topicId) }];
		});
		return { left: stackNotes(all.filter((n) => n.left), NOTE_HEIGHT), right: stackNotes(all.filter((n) => !n.left), NOTE_HEIGHT) };
	}, [layout, showPaper, view.sheet.blocks, colorOf]);

	const savePdf = typeof window !== "undefined" ? window.lh?.savePdf : undefined;
	const canPrint = showPaper && hasBlocks && run?.kind !== "make";
	const title = `${view.className} ${view.deadlineName}`;

	return (
		<>
			<style>{`@page { size: ${PAPERS[sheet.rules.paper].pageSize}; margin: 0; }`}</style>
			<TopBar>
				<nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
					<Link href={`/class/deadline/${encodeURIComponent(deadlineId)}`} className="lh-press flex min-w-0 items-center gap-2 text-ink-2 hover:text-ink">
						<ArrowLeftIcon className="size-4 shrink-0" aria-hidden />
						<span className="truncate">
							{view.className} · {view.deadlineName}
						</span>
					</Link>
					<span className="shrink-0 font-bold text-ink">Cheat sheet</span>
				</nav>
				<StudioStatus view={view} agentName={agentName} agentGone={agentGone} planned={planned.length} fits={fits} fill={layout?.packing.fill ?? 0} showMeter={showPaper && hasBlocks && !!layout} onStop={() => void post({ action: "stop" })} />
				{savePdf && (
					<button
						type="button"
						data-testid="cheat-sheet-save-pdf"
						disabled={!canPrint}
						onClick={() => void savePdf(`${title} cheat sheet`)}
						className="lh-press flex items-center gap-2 bg-panel px-3 py-[7px] text-sm text-ink hover:bg-tone disabled:opacity-40"
					>
						<DownloadIcon className="size-4" aria-hidden />
						Save as PDF
					</button>
				)}
				<button
					type="button"
					data-testid="cheat-sheet-print"
					disabled={!canPrint}
					onClick={() => window.print()}
					className="lh-press flex items-center gap-2 bg-ink px-4 py-[7px] text-sm font-extrabold text-background hover:bg-ink-max disabled:opacity-40"
				>
					<PrinterIcon className="size-4" aria-hidden />
					Print
				</button>
			</TopBar>
			<div className="flex min-h-0 flex-1">
				<Rail
					sheet={sheet}
					leftOut={leftOut}
					fixes={fixes}
					overLines={overLines}
					busy={!!run}
					onEditRules={onEditRules}
					onPrefs={changePrefs}
					onFix={onFix}
					onAdd={(topicId) => void post({ action: "add", topicId })}
				/>
				<div ref={stage} className="min-w-0 flex-1 overflow-auto" onClick={() => setSelected(null)}>
					{(failed ?? view.error) && (
						<p role="alert" className="mx-auto mt-4 w-fit max-w-[600px] bg-panel px-4 py-2.5 text-[13.5px] text-ink">
							<span className="text-ans-wrong">Your agent couldn&apos;t finish that.</span> {failed ?? view.error}
						</p>
					)}
					<div className="flex justify-center gap-5 py-7">
						<div className="relative shrink-0" style={{ width: MARGIN }}>
							{notes.left.map((n) => (
								<Note key={n.id} text={n.text} color={n.color} y={n.y} align="right" over={n.over} />
							))}
							{block && spot && spot.column === 0 && (
								<div className="absolute right-0" style={{ top: spot.y }} onClick={(e) => e.stopPropagation()}>
									<AskPanel key={block.id} block={block} color={colorOf(block.topicId)} busy={!!run} onAsk={(text) => post({ action: "change", how: "ask", blockIds: [block.id], text })} />
								</div>
							)}
						</div>
						<div className="relative shrink-0" style={{ width: g.width * scale }}>
							{noAgent ? (
								<NoAgent width={g.width * scale} height={g.height * scale} />
							) : !view.sheet.rules.allowed ? (
								<PaperCard width={g.width * scale} height={g.height * scale}>
									<p className="max-w-[380px] font-prose text-[15px] text-ink-2">Your class doesn&apos;t allow a cheat sheet for the {view.deadlineName}.</p>
									<EditRules onClick={onEditRules} />
								</PaperCard>
							) : showPaper ? (
								<Paper
									sheet={sheet}
									items={items}
									title={title}
									subtitle={`${dayLabel(view.date)} · ${PAPERS[sheet.rules.paper].phrase}`}
									status={statusOf}
									scale={scale}
									selected={selected}
									busyIds={busyIds}
									onSelect={setSelected}
									onMove={(id, before) => void post({ action: "move", blockId: id, before })}
									onLayout={setLayout}
								/>
							) : (
								<PaperCard width={g.width * scale} height={g.height * scale}>
									<p className="max-w-[380px] font-prose text-[15px] text-ink-2">Nothing on it yet.</p>
									<EditRules onClick={onEditRules} label="Make my cheat sheet" />
								</PaperCard>
							)}
							{block && spot && (
								<div
									className="absolute z-10"
									style={{ top: Math.max(0, spot.y - 46), left: (g.margin + spot.column * (g.columnWidth + g.gutter)) * scale - 8 }}
									onClick={(e) => e.stopPropagation()}
								>
									<BlockToolbar
										block={block}
										busy={!!run}
										onPin={() => void post({ action: "pin", blockId: block.id, pinned: !block.pinned })}
										onTighten={() => void post({ action: "change", how: "tighten", blockIds: [block.id] })}
										onRedo={() => void post({ action: "change", how: "redo", blockIds: [block.id] })}
										onRemove={() => {
											setSelected(null);
											void post({ action: "remove", blockId: block.id });
										}}
									/>
								</div>
							)}
						</div>
						<div className="relative shrink-0" style={{ width: MARGIN }}>
							{notes.right.map((n) => (
								<Note key={n.id} text={n.text} color={n.color} y={n.y} align="left" over={n.over} />
							))}
							{block && spot && spot.column > 0 && (
								<div className="absolute left-0" style={{ top: spot.y }} onClick={(e) => e.stopPropagation()}>
									<AskPanel key={block.id} block={block} color={colorOf(block.topicId)} busy={!!run} onAsk={(text) => post({ action: "change", how: "ask", blockIds: [block.id], text })} />
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</>
	);
}

function EditRules({ onClick, label = "Edit rules" }: { onClick: () => void; label?: string }) {
	return (
		<button type="button" onClick={onClick} className="lh-press bg-ink px-4 py-[9px] text-sm font-extrabold text-background hover:bg-ink-max">
			{label}
		</button>
	);
}

/** One reason in the margin, with its readiness color. */
function Note({ text, color, y, align, over }: { text: string; color: string; y: number; align: "left" | "right"; over: boolean }) {
	return (
		<p
			data-testid="cheat-sheet-note"
			className={cn("absolute flex w-full items-center gap-2.5 text-[12.5px] leading-5", align === "right" ? "flex-row-reverse text-right" : "", over ? "text-ans-wrong" : "text-ink-2")}
			style={{ top: y, height: NOTE_HEIGHT }}
		>
			{!over && <span className="size-2 shrink-0" style={{ background: color }} aria-hidden />}
			<span className="min-w-0 truncate">{text}</span>
		</p>
	);
}
