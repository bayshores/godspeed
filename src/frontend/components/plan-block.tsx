import { useId, useMemo } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/frontend/lib/utils";
import { usePanZoomViewport, ZoomControls } from "@/frontend/components/pan-zoom-viewport";
import type { PlanBlockData, PlanNodeStatus, PlanTree } from "@/shared/core";
import { derivedNodeStatus, derivePlanStatuses } from "@/shared/core";
import { Hint } from "@/frontend/components/ui/hint";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";
import type { Tone } from "@/frontend/components/lesson/plan-row-model";
import type { PopupMessage } from "@/frontend/components/plan-latest";
import { ARROW_HEAD, blockLayout, edgePathD, HEAD_H, HEAD_W, LINE_H, NODE_H, NODE_W_MIN, STROKE_W, wrapTitle, type LayoutNode } from "@/frontend/components/plan-block-model";

/**
 * PLAN BLOCKS: persisted `data-plan-block` parts render as DAG cards in
 * the transcript flow, the plan dialog shows the live plan, and the plan
 * row of a branching plan carries it drawn tiny.
 *
 * - The card shows the whole DAG. The SVG scales to the column width
 *   (viewBox = layout extent + GRAPH_PAD, so strokes never clip), capped
 *   at the reading text size (TEXT_CAP_SCALE).
 * - Clicking it opens the LIVE plan in "The plan" dialog: the diagram,
 *   statuses derived at click time. Cards are frozen
 *   snapshots rendered as carried; the dialog is the live view.
 *
 * Placement and edge geometry live in plan-block-model.ts; the SVG skin
 * is here. Pan/zoom uses fit-floor semantics: fully zoomed out IS the fit.
 */

/** SVG-unit padding around the layout extent: strokes are centered on the
 *  geometry (half bleeds outside the extent), so the outermost node
 *  borders would clip at the svg edge without it. */
const GRAPH_PAD = 8;
/** Node titles render at text-xs (12px) in svg units. The card scales up
 *  to fill the column but never past the reading text size (17px): the
 *  width cap that makes that hold. */
const TEXT_CAP_SCALE = 17 / 12;

const BOX: Record<PlanNodeStatus, string> = {
	// 50%-opacity fill instead of true transparency: a routed edge passing
	// behind the box composites UNDER the fill, dimmed to half, not shown
	// straight through.
	visited: "fill-panel/50 stroke-ink",
	current: "fill-highlight stroke-ink",
	upcoming: "fill-panel/50 stroke-ink",
};
const TEXT: Record<PlanNodeStatus, string> = {
	visited: "fill-ink text-xs",
	current: "fill-ink text-xs font-medium",
	upcoming: "fill-ink-2 text-xs",
};
// The card shows no progress: every node looks the same.
const MONO_BOX = "fill-panel stroke-ink";
const MONO_TEXT = "fill-ink text-xs";

/** The diagram itself: positioned nodes + bezier edges. Pure-ish render:
 *  every input is data, so SSR render tests pin the whole thing. The root
 *  sets font-family var(--font-prose): node titles render in the READING
 *  font, and the runtime var rides the Appearance reading-font override
 *  (the utility can't: @theme inline bakes literals). */
function PlanDiagram({
	nodes,
	edges,
	statusOf,
	markerId,
	pad,
	textCapScale,
	naturalSize,
	monochrome,
}: {
	nodes: readonly LayoutNode[];
	edges: ReadonlyArray<{ from: string; to: string }>;
	statusOf: (id: string) => PlanNodeStatus;
	markerId: string;
	/** Pads the viewBox by this many svg units so centered strokes never
	 *  clip at the extent edges. */
	pad: number;
	/** Caps the rendered width at extent × scale: the card fills the
	 *  column but never grows past reading size. */
	textCapScale?: number;
	/** Renders at the viewBox width in px (1 svg unit = 1 px at zoom 1);
	 *  the dialog's transform math depends on it. */
	naturalSize?: boolean;
	/** The card's mode: every node the same, statuses never show. */
	monochrome?: boolean;
}) {
	const layout = useMemo(() => blockLayout(nodes, edges), [nodes, edges]);
	const w = Math.max(layout.width, 1);
	const h = Math.max(layout.height, 1);
	const vbW = w + 2 * pad;
	const vbH = h + 2 * pad;
	// The origin rides the ink extent: an arrow bulging past zero shifts
	// the viewBox with it instead of clipping.
	const ox = layout.originX ?? 0;
	const oy = layout.originY ?? 0;
	return (
		<svg
			viewBox={`${ox - pad} ${oy - pad} ${vbW} ${vbH}`}
			className={`block h-auto${naturalSize ? "" : " w-full"}${textCapScale ? " mx-auto" : ""}`}
			style={{
				// The READING font via the runtime var, NOT the font-prose
				// utility: @theme inline bakes the literal into utilities,
				// which would ignore the Appearance reading-font override.
				fontFamily: "var(--font-prose)",
				...(textCapScale ? { maxWidth: `${Math.round(vbW * textCapScale * 100) / 100}px` } : naturalSize ? { width: `${vbW}px` } : {}),
			}}
			role="img"
			aria-label="Plan diagram"
		>
			<defs>
				<marker id={markerId} viewBox="0 0 50.2 104" refX={27.2} refY={52} markerWidth={HEAD_W} markerHeight={HEAD_H} markerUnits="userSpaceOnUse" orient="auto">
					{/* The mouth (x 27.2) sits at refX so the line ends AT the
					    notch; the tip beyond it is solid fill. */}
					<path d={ARROW_HEAD} className="fill-ink-2" />
				</marker>
				{/* Same head, light: links into not-yet-visited nodes fade like the nodes' text. */}
				<marker id={`${markerId}-dim`} viewBox="0 0 50.2 104" refX={27.2} refY={52} markerWidth={HEAD_W} markerHeight={HEAD_H} markerUnits="userSpaceOnUse" orient="auto">
					<path d={ARROW_HEAD} className="fill-border" />
				</marker>
			</defs>
			{edges.map((e) => {
				// Dagre's route for this edge: border-intersected waypoints.
				// Unroutable edges (dangling endpoints) draw nothing.
				const pts = layout.edgePts.get(`${e.from}->${e.to}`);
				if (!pts) return null;
				// The target's box drives the docking gap + entry-angle clamp.
				const tx = layout.x.get(e.to);
				const ty = layout.y.get(e.to);
				const target =
					tx !== undefined && ty !== undefined
						? { x: tx, y: ty, w: layout.nodeW.get(e.to) ?? NODE_W_MIN, h: layout.nodeH.get(e.to) ?? NODE_H }
						: undefined;
				// A link is dark only when BOTH its ends are: a light box's
				// outgoing links stay light even when they point into covered
				// territory.
				const dim = !monochrome && (statusOf(e.from) === "upcoming" || statusOf(e.to) === "upcoming");
				return (
					<path
						key={`${e.from}->${e.to}`}
						d={edgePathD(pts, target)}
						className={dim ? "fill-none stroke-border" : "fill-none stroke-ink-2"}
						strokeWidth={STROKE_W}
						markerEnd={`url(#${markerId}${dim ? "-dim" : ""})`}
					/>
				);
			})}
			{nodes.map((n) => {
				const status = statusOf(n.id);
				const lines = wrapTitle(n.title);
				// The box hugs its wrapped content; text centers in it both ways.
				const nodeH = layout.nodeH.get(n.id) ?? NODE_H;
				const nodeW = layout.nodeW.get(n.id) ?? NODE_W_MIN;
				const y0 = (nodeH - lines.length * LINE_H) / 2 + 10;
				return (
					<g key={n.id} transform={`translate(${layout.x.get(n.id) ?? 0}, ${layout.y.get(n.id) ?? 0})`} data-testid={`plan-node-${n.id}`} data-status={status}>
						<rect width={nodeW} height={nodeH} className={monochrome ? MONO_BOX : BOX[status]} strokeWidth={STROKE_W} />
						{lines.map((line, i) => (
							<text key={i} x={nodeW / 2} y={y0 + i * LINE_H} textAnchor="middle" className={monochrome ? MONO_TEXT : TEXT[status]}>
								{line}
							</text>
						))}
					</g>
				);
			})}
		</svg>
	);
}

/**
 * A persisted plan-block part, rendered as carried (snapshot statuses,
 * never re-derived): a card that opens the live plan dialog.
 */
export function PlanBlock({ data, onOpen }: { data: PlanBlockData; onOpen: () => void }) {
	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");
	const statusMap = useMemo(() => new Map(data.nodes.map((n) => [n.id, n.status] as const)), [data]);
	const statusOf = (id: string): PlanNodeStatus => statusMap.get(id) ?? "upcoming";
	return (
		<Hint label="Open the full plan" side="bottom">
			<button
				type="button"
				data-testid="plan-block-full"
				aria-label="Open the full plan"
				onClick={onOpen}
				className="block w-full rounded border border-edge bg-background px-4 py-3 text-left"
			>
				<PlanDiagram nodes={data.nodes} edges={data.edges} statusOf={statusOf} markerId={markerId} pad={GRAPH_PAD} textCapScale={TEXT_CAP_SCALE} monochrome />
			</button>
		</Hint>
	);
}

/** The mini map's largest size and its boxes' size, in px, and its
 *  padding in layout units. */
const MAP_H = 36;
const MAP_W = 140;
const MAP_BOX_W = 22;
const MAP_BOX_H = 6;
const MAP_PAD = 4;
const MAP_FILL: Record<Tone, string> = { done: "fill-ink", current: "", later: "fill-tone-2" };

/**
 * The plan diagram drawn tiny for the plan row: one box per step in its
 * tone (the current one in the space's color), thin links, no text. A
 * click opens the plan dialog.
 */
export function PlanMiniMap({
	steps,
	edges,
	color,
	onOpen,
}: {
	steps: ReadonlyArray<{ key: string; tone: Tone }>;
	edges: ReadonlyArray<{ from: string; to: string }>;
	/** The current step's fill. */
	color: string;
	onOpen: () => void;
}) {
	// Blank titles: every box the same size, so the map reads by its shape.
	const layout = useMemo(() => blockLayout(steps.map((s) => ({ id: s.key, title: "" })), edges), [steps, edges]);
	const vbW = layout.width + 2 * MAP_PAD;
	const vbH = layout.height + 2 * MAP_PAD;
	// Each axis scales on its own: a top-to-bottom plan would draw tall and
	// thin, so the boxes stretch into short bars like the row's.
	const width = Math.min(MAP_W, (vbW * MAP_BOX_W) / NODE_W_MIN);
	const height = Math.min(MAP_H, (vbH * MAP_BOX_H) / NODE_H);
	return (
		<Hint label="Open the plan map" side="bottom">
			<button type="button" data-testid="plan-map-open" aria-label="Open the plan map" onClick={onOpen} className="block">
				<svg viewBox={`${(layout.originX ?? 0) - MAP_PAD} ${(layout.originY ?? 0) - MAP_PAD} ${vbW} ${vbH}`} width={width} height={height} preserveAspectRatio="none" aria-hidden className="block">
					{edges.map((e) => {
						const pts = layout.edgePts.get(`${e.from}->${e.to}`);
						return pts && <path key={`${e.from}->${e.to}`} d={`M${pts.map((pt) => `${pt.x},${pt.y}`).join("L")}`} className="fill-none stroke-ink-2" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
					})}
					{steps.map((s) => (
						<rect
							key={s.key}
							data-tone={s.tone}
							x={layout.x.get(s.key) ?? 0}
							y={layout.y.get(s.key) ?? 0}
							width={layout.nodeW.get(s.key) ?? NODE_W_MIN}
							height={layout.nodeH.get(s.key) ?? NODE_H}
							className={MAP_FILL[s.tone]}
							style={s.tone === "current" ? { fill: color } : undefined}
						/>
					))}
				</svg>
			</button>
		</Hint>
	);
}

/**
 * "The plan" dialog, live: the lesson's plan diagram with statuses derived
 * at click time. Drag pans it, wheel zooms to the cursor, and the zoom
 * floor is the fit (panning locks at it, nothing to move).
 */
export function PlanPopup({
	tree,
	messages,
	onClose,
	state = "open",
}: {
	/** The lesson's plan (the same one its plan row shows). */
	tree: PlanTree | null;
	messages: readonly PopupMessage[];
	onClose: () => void;
	/** Fade state: the caller keeps the dialog mounted through its exit
	 *  with usePresence. */
	state?: "open" | "closed";
}) {
	const statuses = useMemo(() => (tree ? derivePlanStatuses(tree, messages as Parameters<typeof derivePlanStatuses>[1]) : null), [tree, messages]);
	const statusOf = (id: string): PlanNodeStatus => (statuses ? derivedNodeStatus(statuses, id) : "upcoming");

	const layout = useMemo(() => (tree ? blockLayout(tree.nodes, tree.edges) : null), [tree]);
	// The fit box is the PADDED ink box: the diagram renders with GRAPH_PAD.
	const box = useMemo(() => (layout ? { w: layout.width + 2 * GRAPH_PAD, h: layout.height + 2 * GRAPH_PAD } : { w: 0, h: 0 }), [layout]);
	const { viewportRef, view, atFloor, settled, panning, startDrag, moveDrag, endDrag, stepZoom, fitView } = usePanZoomViewport(box, true);
	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");

	if (typeof document === "undefined") return null;
	return createPortal(
		<DialogSheet title="The plan" state={state} testid="plan-popup" onClose={onClose} className="w-[640px]">
			<p className="text-[14px] text-ink-2">Updates as you answer</p>
			{tree ? (
				<div
					ref={viewportRef}
					className={cn("relative h-[420px] shrink-0 touch-none overflow-hidden border border-edge bg-background select-none", atFloor ? "cursor-default" : "cursor-grab")}
					onPointerDown={startDrag}
					onPointerMove={moveDrag}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
				>
					<div
						className="absolute top-0 left-0 origin-top-left"
						style={{
							transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
							// Hidden until the first fit has APPLIED: the fit runs in an
							// effect (after paint), so the diagram can never flash at the
							// initial top-left zoom:1 state.
							opacity: settled ? 1 : 0,
							transition: panning || !settled ? "none" : "transform 180ms ease-out, opacity 160ms ease-out",
						}}
					>
						<PlanDiagram nodes={tree.nodes} edges={tree.edges} statusOf={statusOf} markerId={markerId} pad={GRAPH_PAD} naturalSize />
					</div>
					<ZoomControls fitLabel="Fit plan to screen" fitTestId="plan-popup-fit" onStep={stepZoom} onFit={fitView} />
				</div>
			) : (
				<p className="text-[15px] text-ink-2">No plan in this lesson yet.</p>
			)}
		</DialogSheet>,
		document.body,
	);
}
