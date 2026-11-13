import { useMemo } from "react";
import { chainsForSelection, formatChainLine } from "@/shared/core";
import type { GraphChain, GraphNode } from "@/shared/core";
import { usePresence } from "@/frontend/components/presence";
import { LatexGlyph } from "@/frontend/components/latex-glyph";
import { KEY_ON_INK } from "@/frontend/components/ui/card-parts";
import { FIELD } from "@/frontend/components/ui/field";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { countLine, factCount, groupChains, groupName, matchingChains, tickState, type ChainSort, type ReasoningChain } from "./chain-table-model";

const SORTS = [
	{ col: "name", label: "Name" },
	{ col: "props", label: "Facts" },
	{ col: "created", label: "Created" },
] as const;

/** The right end of a group or chain row: how many facts and the newest. */
const TALLY = "shrink-0 font-count text-[15px] text-ink-2";

/**
 * "All facts": every fact of the space in three levels, the lesson or
 * file it came from, its chains written as `A ∧ B ⟹ C`, and each fact's
 * statement. Search, sort and the picked facts come in as props (the
 * overlay owns them), so the render tests draw this directly.
 */
export function ChainTableBody({
	nodes,
	chains: storedChains,
	sessions,
	fileSources,
	spaceLabel,
	query,
	onQuery,
	sort,
	onSort,
	selection,
	expandedClusters,
	expandedChains,
	onToggleCluster,
	onToggleChain,
	onToggleNodes,
	onClear,
	onDelete,
	onClose,
	selectMode,
	onSelect,
}: {
	nodes: GraphNode[];
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	/** The space's name for the count line. */
	spaceLabel: string | null;
	query: string;
	onQuery: (v: string) => void;
	sort: ChainSort;
	onSort: (col: ChainSort["col"]) => void;
	selection: ReadonlySet<string>;
	expandedClusters: ReadonlySet<string>;
	expandedChains: ReadonlySet<string>;
	onToggleCluster: (key: string) => void;
	onToggleChain: (id: string) => void;
	/** Every box (group, chain or fact) picks or unpicks fact ids. */
	onToggleNodes: (ids: string[], next: boolean) => void;
	onClear: () => void;
	onDelete: () => void;
	onClose: () => void;
	/** Picking facts to start from: the bar's "Done" replaces "Delete". */
	selectMode?: boolean;
	onSelect?: () => void;
}) {
	const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
	const names = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, { name: n.name }])), [nodes]);
	const chains = useMemo(() => chainsForSelection(nodes, storedChains), [nodes, storedChains]);
	const searching = query.trim() !== "";
	const groups = useMemo(
		() => groupChains(matchingChains(chains, byId, query), byId, sessions, fileSources, sort),
		[chains, byId, query, sessions, fileSources, sort],
	);
	// The bar fades out before it unmounts.
	const bar = usePresence(selection.size > 0);
	const nameOf = (id: string) => byId.get(id)?.name ?? id;
	const dateOf = (id: string) => byId.get(id)?.createdAt.slice(0, 10) ?? "";

	return (
		<div data-testid="chain-table" className="relative flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 pt-8 pb-28">
					<div className="flex flex-wrap items-center gap-3.5">
						<div className="flex min-w-0 flex-1 flex-col gap-0.5">
							<h1 className="text-[30px] leading-tight text-ink">All facts</h1>
							<p data-testid="chain-table-count" className="text-[15px] text-ink-2">
								{countLine(nodes.length, spaceLabel)}
							</p>
						</div>
						<input
							value={query}
							data-testid="chain-table-search"
							onChange={(e) => onQuery(e.target.value)}
							placeholder="Search facts…"
							aria-label="Search facts"
							spellCheck={false}
							className={cn(FIELD, "w-[260px] max-w-full")}
						/>
						<button type="button" data-testid="chain-table-close" onClick={onClose} className="lh-btn text-[15px]">
							<PixelIcon name="close" />
							Close
						</button>
					</div>

					<div className="flex flex-col gap-1">
						{selectMode && <h2 className="text-lg text-ink">Pick the facts to start from</h2>}
						<p data-testid="chain-table-hint" className="text-[15px] text-ink-2">
							Picking a file or a fact also picks the facts it builds on.
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-1.5">
						<span className="mr-1 text-[15px] text-ink-2">Sort by</span>
						{SORTS.map(({ col, label }) => {
							const on = sort.col === col;
							return (
								<button
									key={col}
									type="button"
									data-testid={`sort-${col}`}
									onClick={() => onSort(col)}
									aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
									className={cn("lh-btn text-[15px]", on ? "h-auto px-2.5 py-[5px]" : "lh-btn-quiet")}
								>
									{label}
									{on && <PixelIcon name="chevron" className={cn("h-2", sort.dir === 1 ? "-rotate-90" : "rotate-90")} />}
								</button>
							);
						})}
					</div>

					<div className="rounded border-2 border-line bg-panel px-6 py-2.5">
						{groups.length === 0 && (
							<p data-testid="chain-table-nomatch" className="py-2.5 text-[15px] text-ink-2">
								No matching facts.
							</p>
						)}
						{groups.map((group) => {
							const open = searching || expandedClusters.has(group.key);
							const label = groupName(group);
							return (
								<div key={group.key} data-testid={`cluster-group-${group.key}`} className="border-b-2 border-dotted border-edge last:border-b-0">
									<div className="flex items-center gap-3 py-2.5">
										<TickBox
											{...tickState(group.nodeIds, selection)}
											onToggle={(next) => onToggleNodes(group.nodeIds, next)}
											testid={`cluster-checkbox-${group.key}`}
											label={`Select all facts from ${group.label ?? "unlabeled"}`}
										/>
										<Expander open={open} onClick={() => onToggleCluster(group.key)} testid={`cluster-toggle-${group.key}`} label={`Expand ${group.label ?? "unlabeled"}`} />
										<span title={group.label ?? undefined} className={cn("min-w-0 truncate text-lg font-medium", label ? "text-ink" : "text-ink-3")}>
											{label ?? "unlabeled"}
										</span>
										{group.kind === "chat" && <span className="shrink-0 rounded-sm bg-tone-2 px-[7px] py-px text-xs font-medium text-ink">Lesson</span>}
										<span className="flex-1" />
										<span className={TALLY}>{factCount(group.nodeIds.length)}</span>
										<span className={cn(TALLY, "text-ink-3")}>{group.newestCreatedAt.slice(0, 10)}</span>
									</div>
									{open &&
										group.chains.map((chain) => (
											<ChainBlock
												key={chain.id}
												chain={chain}
												open={expandedChains.has(chain.id)}
												line={formatChainLine(chain, names)}
												byId={byId}
												nameOf={nameOf}
												date={dateOf(chain.conclusion)}
												selection={selection}
												onToggle={() => onToggleChain(chain.id)}
												onToggleNodes={onToggleNodes}
											/>
										))}
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{bar.mounted && (
				<div className="pointer-events-none absolute inset-x-0 bottom-7 z-10 flex justify-center px-4">
					<div
						data-testid="chain-selection-bar"
						data-state={bar.state}
						className="lh-pop pointer-events-auto flex h-14 w-[560px] max-w-full items-center gap-2.5 rounded-sm bg-ink pr-2.5 pl-5 text-background"
					>
						<span data-testid="chain-selected-summary" className="min-w-0 flex-1 truncate text-lg font-medium">
							{factCount(selection.size)} picked
						</span>
						<button type="button" data-testid="chain-clear" onClick={onClear} className={ON_INK}>
							Clear
						</button>
						{selectMode ? (
							<button
								type="button"
								data-testid="chain-practice-done"
								onClick={onSelect}
								aria-label={`Done picking: ${factCount(selection.size)} selected`}
								className={cn(ON_INK, "text-ink [--lh-key:var(--background)] [--lh-key-hover:color-mix(in_srgb,var(--background)_90%,var(--foreground))]")}
							>
								Done
							</button>
						) : (
							<button type="button" data-testid="chain-delete" onClick={onDelete} aria-label={`Delete ${selection.size} selected ${selection.size === 1 ? "fact" : "facts"}`} className={ON_INK}>
								Delete
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/** A button on the dark picked bar: a key in the paper color. */
const ON_INK = cn("lh-btn shrink-0 text-[15px] text-background", KEY_ON_INK);

/** A chain's row (its facts as chips joined by ∧ and ⟹) and, opened,
 *  each fact's statement. */
function ChainBlock({
	chain,
	open,
	line,
	byId,
	nameOf,
	date,
	selection,
	onToggle,
	onToggleNodes,
}: {
	chain: ReasoningChain;
	open: boolean;
	/** The plain-text chain for screen readers. */
	line: string;
	byId: ReadonlyMap<string, GraphNode>;
	nameOf: (id: string) => string;
	date: string;
	selection: ReadonlySet<string>;
	onToggle: () => void;
	onToggleNodes: (ids: string[], next: boolean) => void;
}) {
	const ids = [...chain.premises, chain.conclusion];
	return (
		<div data-testid={`chain-block-${chain.id}`} className="lh-rise">
			<div data-testid={`chain-row-${chain.id}`} aria-label={line} className="flex items-center gap-3 py-[9px] pl-[34px]">
				<TickBox
					{...tickState(ids, selection)}
					onToggle={(next) => onToggleNodes(ids, next)}
					testid={`chain-checkbox-${chain.id}`}
					label={`Select ${nameOf(chain.conclusion)} and the facts it builds on`}
				/>
				<Expander open={open} onClick={onToggle} testid={`chain-toggle-${chain.id}`} label={`Expand ${nameOf(chain.conclusion)}`} />
				<span className="flex min-w-0 flex-1 flex-wrap items-center gap-y-1 text-[15px] leading-tight text-ink">
					{ids.map((id, i) => (
						<span key={id} className="flex items-center">
							{i > 0 &&
								(i === ids.length - 1 ? (
									<LatexGlyph cmd="\implies" testid={`chain-implies-${chain.id}`} className="px-1.5 text-ink" />
								) : (
									<LatexGlyph cmd="\land" testid={`chain-and-${chain.id}-${i}`} className="px-1.5 text-ink" />
								))}
							<span data-testid={`prop-chip-${id}`} className="rounded-sm border border-edge bg-background px-1.5 py-0.5">
								{nameOf(id)}
							</span>
						</span>
					))}
				</span>
				<span className={TALLY}>{factCount(ids.length)}</span>
				<span className={cn(TALLY, "text-ink-3")}>{date}</span>
			</div>
			{open &&
				ids.map((id) => {
					const node = byId.get(id);
					if (!node) return null;
					return (
						<div key={id} data-testid={`prop-row-${id}`} className="lh-rise flex items-start gap-3 py-[9px] pl-[68px]">
							<TickBox checked={selection.has(id)} onToggle={(next) => onToggleNodes([id], next)} testid={`prop-checkbox-${id}`} label={`Select ${node.name}`} />
							<span className="min-w-0 flex-1 pt-px text-[15px] text-ink">{node.statement}</span>
						</div>
					);
				})}
		</div>
	);
}

/** Opens and closes a group or chain: the chevron turns down when open. */
function Expander({ open, onClick, testid, label }: { open: boolean; onClick: () => void; testid: string; label: string }) {
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={onClick}
			aria-label={label}
			aria-expanded={open}
			className="flex size-5 shrink-0 items-center justify-center rounded-sm text-ink hover:bg-tone"
		>
			<PixelIcon name="chevron" className={cn("h-2.5 transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open && "rotate-90")} />
		</button>
	);
}

/** The pick box: ticked, half ticked (some of a group's facts) or empty.
 *  The real checkbox stays for screen readers and carries `indeterminate`. */
function TickBox({
	checked,
	mixed = false,
	onToggle,
	testid,
	label,
}: {
	checked: boolean;
	mixed?: boolean;
	onToggle: (next: boolean) => void;
	testid: string;
	label: string;
}) {
	return (
		<label className="relative flex size-5 shrink-0 cursor-pointer">
			<input
				type="checkbox"
				checked={checked}
				ref={(el) => {
					if (el) el.indeterminate = mixed;
				}}
				data-testid={testid}
				aria-label={label}
				onChange={(e) => onToggle(e.target.checked)}
				className="peer sr-only"
			/>
			<span
				aria-hidden
				className={cn(
					"flex size-5 items-center justify-center rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
					checked || mixed ? "bg-tint text-background" : "border-2 border-ink bg-background",
				)}
			>
				{checked ? <PixelIcon name="check" className="h-[9px]" /> : mixed && <PixelIcon name="minus" className="h-[9px]" />}
			</span>
		</label>
	);
}
