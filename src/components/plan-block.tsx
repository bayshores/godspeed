import { useEffect, useId, useMemo } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
// The placement engine is mermaid's own: dagre-d3-es, the fork mermaid 11
// ships with. The deep subpath is how mermaid itself imports it.
import { graphlib } from "dagre-d3-es";
import { layout as dagreLayout } from "dagre-d3-es/src/dagre/index.js";
// Mermaid's default flowchart edge curve: dagre's waypoints drawn through
// d3's curveBasis (the exact recipe dagre-d3's own renderer uses).
import { curveBasis, line } from "d3-shape";
import { usePanZoomViewport, ZoomControls } from "@/components/pan-zoom-viewport";
import type { PlanBlockData, PlanNodeStatus } from "@/core";
import { derivedNodeStatus, derivePlanStatuses } from "@/core";
import { Hint } from "@/components/ui/hint";
import { latestTree, type PopupMessage } from "@/components/plan-latest";

/**
 * PLAN BLOCKS: persisted `data-plan-block` parts render as DAG blocks in
 * the transcript flow.
 *
 * - kind "full": the whole DAG, borderless. The SVG scales to the column
 *   width (viewBox = layout extent + GRAPH_PAD, so strokes and glow never
 *   clip), capped at the chat prose font size (TEXT_CAP_SCALE).
 * - Clicking opens the LIVE plan in a session-scoped focus overlay: the
 *   latest tree with statuses derived at click time. Blocks are frozen
 *   snapshots rendered as carried; the popup is the live view.
 *
 * Placement runs on dagre (deterministic, synchronous, DOM-free, so SSR
 * and render tests stay exact); the SVG skin is ours. Pan/zoom uses
 * fit-floor semantics: fully zoomed out IS the fit.
 */

// ─── Layout constants + pure helpers (exported for tests) ────────────────────

/** Text-first node sizing: the box hugs its wrapped text. Width comes
 * from a per-character-class width estimate plus symmetric padding,
 * floored so short titles don't collapse into pills. An estimate, not
 * canvas measurement, so layout stays deterministic and DOM-free. */

/** Symmetric horizontal padding, equal to the vertical padding the
 * single-line text gets in NODE_H: (44 − 11) / 2 ≈ 16 (the prose font
 * renders text-xs at 11px). */
const PAD_X = 16;
export const NODE_W_MIN = 96;
export const NODE_H = 44;

// Width classes for the PROSE font (Source Sans 3 as shipped, text-xs
// rendering at 11px): narrow stems and punctuation, wide m/w, caps +
// digits, everything else. Rates least-squares-fitted against
// getComputedTextLength() measurements of real plan titles; residuals
// land within ±4px per LINE, so
// per-side padding reads as PAD_X ±2. A different reading font
// (Appearance override) drifts the estimate slightly; accepted.
const NARROW_CHARS = new Set(" ijltfr.,:;'!|()[]-\\");
const WIDE_CHARS = new Set("mwMW@");
const CAP_DIGIT = /[A-Z0-9]/;

/** Estimated rendered width (px) of one line at text-xs. Pure. */
export function estimateLineWidth(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (NARROW_CHARS.has(ch)) w += 3.1;
		else if (WIDE_CHARS.has(ch)) w += 9.2;
		else if (CAP_DIGIT.test(ch)) w += 6.0;
		else w += 5.4;
	}
	return w;
}
/** Baseline-to-baseline distance of node titles. */
const LINE_H = 13;
export const GAP_X = 24;
const GAP_Y = 48;

/** A node for layout purposes — the payload's shape and the tree's shape agree. */
export interface LayoutNode {
	id: string;
	title: string;
}

/** Placement: dagre's layered layout, TB, with our geometry (text-first
 *  sized boxes, GAP_X/GAP_Y separations, zero margin; the caller adds
 *  GRAPH_PAD/POPUP_PAD). Dagre returns node centers; we hand back
 *  top-lefts. Dangling edges are ignored: a ghost endpoint would spawn
 *  an unmeasured node and break the measurer. */
export function blockLayout(nodes: readonly LayoutNode[], edges: ReadonlyArray<{ from: string; to: string }>) {
	const x = new Map<string, number>();
	const y = new Map<string, number>();
	const nodeH = new Map<string, number>();
	const nodeW = new Map<string, number>();
	/** Dagre's per-edge waypoint routes — each starts/ends at the node
	 *  border intersection on whatever SIDE the edge leaves/enters.
	 *  Keyed `${from}->${to}`. */
	const edgePts = new Map<string, Array<{ x: number; y: number }>>();
	if (nodes.length === 0) return { x, y, nodeH, nodeW, edgePts, width: 0, height: 0 };
	const ids = new Set(nodes.map((n) => n.id));
	const routed: Array<{ from: string; to: string }> = [];
	const g = new graphlib.Graph({ compound: false, multigraph: true });
	g.setGraph({ rankdir: "TB", nodesep: GAP_X, ranksep: GAP_Y, marginx: 0, marginy: 0 });
	for (const n of nodes) {
		const lines = wrapTitle(n.title);
		const h = NODE_H + Math.max(0, lines.length - 2) * LINE_H;
		nodeH.set(n.id, h);
		nodeW.set(n.id, nodeWidth(lines));
		g.setNode(n.id, { width: nodeW.get(n.id)!, height: h });
	}
	for (const e of edges) {
		if (ids.has(e.from) && ids.has(e.to)) {
			g.setEdge(e.from, e.to, { label: "", width: 0, height: 0 });
			routed.push(e);
		}
	}
	// (the d.ts marks opts required; the runtime ignores it)
	dagreLayout(g, undefined);
	for (const n of nodes) {
		const pos = g.node(n.id);
		const h = nodeH.get(n.id) ?? NODE_H;
		const w = nodeW.get(n.id) ?? NODE_W_MIN;
		if (pos) {
			x.set(n.id, pos.x - w / 2);
			y.set(n.id, pos.y - h / 2);
		}
	}
	for (const e of routed) {
		const pts: Array<{ x: number; y: number }> | undefined = g.edge(e.from, e.to)?.points;
		if (pts) edgePts.set(`${e.from}->${e.to}`, pts.map((pt) => ({ x: pt.x, y: pt.y })));
	}
	// The canvas must cover the arrows: dagre's graph extent is the NODE
	// bounding box, and edge curves can bow past it (cross-column
	// edges' bezier control points). The ink extent unions the node boxes with
	// every edge path's control-point hull: a bezier never leaves the
	// hull of its control points, and parsing the d-string edgePathD
	// builds (the SAME call the renderer makes, same inputs) bounds every
	// segment — M, L and C pairs alternate strictly, so even/odd matches
	// are x/y. Dagre's extent stays the FLOOR: plans whose arrows stay
	// inside keep byte-identical viewBoxes (no reflow of every pinned
	// render), and the origin only moves when ink bulges past zero.
	let inkMinX = Infinity;
	let inkMinY = Infinity;
	let inkMaxX = -Infinity;
	let inkMaxY = -Infinity;
	const stretch = (px: number, py: number) => {
		if (px < inkMinX) inkMinX = px;
		if (py < inkMinY) inkMinY = py;
		if (px > inkMaxX) inkMaxX = px;
		if (py > inkMaxY) inkMaxY = py;
	};
	for (const n of nodes) {
		const nx = x.get(n.id);
		const ny = y.get(n.id);
		if (nx === undefined || ny === undefined) continue;
		stretch(nx, ny);
		stretch(nx + (nodeW.get(n.id) ?? NODE_W_MIN), ny + (nodeH.get(n.id) ?? NODE_H));
	}
	for (const e of routed) {
		const pts = edgePts.get(`${e.from}->${e.to}`);
		if (!pts) continue;
		const tx = x.get(e.to);
		const ty = y.get(e.to);
		const target =
			tx !== undefined && ty !== undefined
				? {
						x: tx,
					y: ty,
					w: nodeW.get(e.to) ?? NODE_W_MIN,
						h: nodeH.get(e.to) ?? NODE_H,
					}
				: undefined;
		const nums = edgePathD(pts, target).match(/-?\d+(?:\.\d+)?/g);
		if (!nums) continue;
		for (let i = 0; i + 1 < nums.length; i += 2) {
			stretch(parseFloat(nums[i]!), parseFloat(nums[i + 1]!));
		}
	}
	// Dagre coordinates start at 0; only ink past zero on the negative
	// side moves the origin (viewBox x/y shift with it).
	const originX = Math.min(0, inkMinX === Infinity ? 0 : inkMinX);
	const originY = Math.min(0, inkMinY === Infinity ? 0 : inkMinY);
	return {
		x,
		y,
		nodeH,
		nodeW,
		edgePts,
		originX,
		originY,
		width: Math.max((g.graph().width ?? 0) - originX, inkMaxX === -Infinity ? 0 : inkMaxX - originX, 1),
		height: Math.max((g.graph().height ?? 0) - originY, inkMaxY === -Infinity ? 0 : inkMaxY - originY, 1),
	};
}

/** Greedy word wrap to lines of ≤ maxChars. Nothing is dropped: the
 *  node's box grows to fit every line. A single oversized word is
 *  hard-chunked across lines at maxChars. */
export function wrapTitle(title: string, maxChars = 28): string[] {
	const words = title.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [""];
	// Oversized words can never fit a line — chunk them so no content is lost.
	const atoms: string[] = [];
	for (const w of words) {
		for (let i = 0; i < w.length; i += maxChars) atoms.push(w.slice(i, i + maxChars));
	}
	const lines: string[] = [];
	for (const a of atoms) {
		const last = lines[lines.length - 1];
		if (last !== undefined && last.length + 1 + a.length <= maxChars) {
			lines[lines.length - 1] = `${last} ${a}`;
		} else {
			lines.push(a);
		}
	}
	return lines;
}

// ─── Geometry caps ───────────────────────────────────────────────────────────

/** A node's box width for its wrapped lines — the hug itself. Pure. */
export function nodeWidth(lines: readonly string[]): number {
	const widest = Math.max(1, ...lines.map(estimateLineWidth));
	return Math.max(NODE_W_MIN, Math.ceil(widest) + 2 * PAD_X);
}

/** SVG-unit padding around the layout extent: strokes are centered on the
 *  geometry (half bleeds outside the extent) and the glow halo reaches −4 —
 *  without this pad the outermost node borders clip at the svg edge. */
const GRAPH_PAD = 8;
/** The current node's yellow glow: a fill blurred so it bleeds over the
 *  node's edges. A Gaussian's visible spread is ≈3σ, so the glow
 *  reaches GLOW_MARGIN + 3·GLOW_BLUR past the node; any surface that
 *  shows the glow must pad its viewBox by GLOW_REACH or the blur clips
 *  at the frame edge. */
const GLOW_MARGIN = 8;
const GLOW_BLUR = 5;
const GLOW_REACH = GLOW_MARGIN + 3 * GLOW_BLUR;
/** Node titles render at text-xs (12.5px) in svg units. The in-chat block
 *  scales up to fill the column but NEVER past the chat prose size
 *  (--lh-prose-size, 16px — the ladder's reading rung) — the width cap
 *  that makes that hold. */
const TEXT_CAP_SCALE = 16 / 12.5;

// ─── Arrowhead ───────────────────────────────────────────────────────────────

/** Baked from arrowhead_1.svg (the CM/MJX long-arrow head), transform chain
 *  collapsed: viewBox 0 0 50.2 104, tip at (50.2, 52), notch mouth at
 *  x 27.2 with a 9.6-tall opening — at full height 104 the tail opening
 *  is ≈10. Solid white fill, no padding. */
const ARROW_HEAD = "M48,55.2C49.4,54.6 50.2,53.4 50.2,52C50.2,50.6 49.4,49.4 48,48.8C38.2,45.6 29.2,38.8 21,28.4C15.2,21.4 11.4,13.2 9.6,3.8C9,1.2 7.4,0 4.8,0C1.6,0 0,1.6 0,5L0.2,5.6C3.6,23 12.6,36.8 27.2,47.2L27.2,56.8C12.6,67.2 3.6,81 0.2,98.4L0,99C0,102.4 1.6,104 4.8,104C7.4,104 9,102.8 9.6,100.2C11.4,90.8 15.2,82.6 21,75.6C29.2,65.2 38.2,58.4 48,55.2Z";
/** Lines + outlines run at the app's standard 1px border weight. */
const STROKE_W = 1;
/** Sized to the 1px line so the LaTeX head:shaft ratio (tail opening
 *  tucking the line flush) holds exactly. */
const HEAD_H = 16 * (STROKE_W / 1.5);
const HEAD_SCALE = HEAD_H / 104;
const HEAD_W = 50.2 * HEAD_SCALE;
/** The drawn line terminates at the notch mouth (refX 27.2) — it never
 *  reaches the narrow tip, where it would show through. The tip
 *  overhangs the line's end by this much, so edges shorten by it to land
 *  the tip exactly on the target node's border. */
const HEAD_TIP_OVERHANG = (50.2 - 27.2) * HEAD_SCALE;
/** The head floats this far off the target face. ~Half a head length:
 *  clearly docked off, still visually attached. */
const DOCK_GAP = 4 * (STROKE_W / 1.5);
/** The shaft stub, the straight run before the head:
 *  control points from Q on sit exactly on the approach line, so the
 *  basis spline renders that stretch perfectly straight and the head
 *  lands on a straight shaft; the corner where the route squares up onto
 *  the line is rounded by the curve. ~1.5 head lengths of shaft. */
const STRAIGHT_RUN = 12;
/** The tilt limit at the termination point, measured off the entry
 *  face's perpendicular: past ±40° one of the head's barbs crosses the
 *  tip's level and the silhouette breaks. The final run swings to the
 *  cone edge instead. */
const ENTRY_ANGLE_LIMIT = (40 * Math.PI) / 180;
const edgeLine = line<{ x: number; y: number }>()
	.x((p) => p.x)
	.y((p) => p.y)
	.curve(curveBasis);

/** The entry face's outward unit normal — whichever face of the target
 *  box dagre's border point sits on. Pure. */
function faceNormal(
	border: { x: number; y: number },
	box: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
	const d = { top: border.y - box.y, bottom: box.y + box.h - border.y, left: border.x - box.x, right: box.x + box.w - border.x };
	const face = (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[a] <= d[b] ? a : b));
	switch (face) {
		case "top":
			return { x: 0, y: -1 };
		case "bottom":
			return { x: 0, y: 1 };
		case "left":
			return { x: -1, y: 0 };
		default:
			return { x: 1, y: 0 };
	}
}

/** The edge path — mermaid's own line drawing: dagre's border-intersected
 *  waypoints through d3's curveBasis (mermaid's default flowchart curve —
 *  the same recipe dagre-d3's renderer uses). The head docks off the
 *  target: its TIP floats DOCK_GAP past the border along the FACE NORMAL
 *  (constant gap at any tilt), its mouth sits at the path's end on a
 *  straight run (the shaft stub), and — when the target box is given —
 *  the entry direction is clamped to ±ENTRY_ANGLE_LIMIT of the face's
 *  perpendicular: a steeper natural approach swings to
 *  the 40° cone edge instead of breaking the head's silhouette. Without
 *  a target box the unclamped geometry applies. Straight collinear
 *  routes render identically. Pure, exported for tests. */
export function edgePathD(
	points: Array<{ x: number; y: number }>,
	target?: { x: number; y: number; w: number; h: number },
): string {
	const pts = points.map((p) => ({ ...p }));
	if (pts.length >= 2) {
		const last = pts[pts.length - 1]!;
		const prev = pts[pts.length - 2]!;
		const dx = last.x - prev.x;
		const dy = last.y - prev.y;
		const len = Math.hypot(dx, dy) || 1;
		let ux = dx / len;
		let uy = dy / len;
		// The tip: DOCK_GAP outside the face along its normal (or along the
		// approach when no box is known).
		let tipx: number;
		let tipy: number;
		if (target) {
			const n = faceNormal(last, target);
			tipx = last.x + n.x * DOCK_GAP;
			tipy = last.y + n.y * DOCK_GAP;
			// Clamp the approach to the ±LIMIT cone around the normal: if
			// the outgoing direction -u tilts past ENTRY_ANGLE_LIMIT, swing
			// it to the cone edge (same rotation side as the route).
			const v = { x: -ux, y: -uy };
			const vn = v.x * n.x + v.y * n.y;
			if (vn < Math.cos(ENTRY_ANGLE_LIMIT)) {
				const t = { x: v.x - vn * n.x, y: v.y - vn * n.y };
				const tl = Math.hypot(t.x, t.y);
				const that = tl > 0 ? { x: t.x / tl, y: t.y / tl } : { x: -n.y, y: n.x };
				const c = Math.cos(ENTRY_ANGLE_LIMIT);
				const s = Math.sin(ENTRY_ANGLE_LIMIT);
				v.x = c * n.x + s * that.x;
				v.y = c * n.y + s * that.y;
				ux = -v.x;
				uy = -v.y;
			}
		} else {
			tipx = last.x - ux * DOCK_GAP;
			tipy = last.y - uy * DOCK_GAP;
		}
		// The mouth: overhang back from the tip along the (clamped) approach.
		const M = { x: tipx - ux * HEAD_TIP_OVERHANG, y: tipy - uy * HEAD_TIP_OVERHANG };
		// From Q the control points lie on the approach line — the basis
		// spline renders Q→M perfectly straight (a B-spline span with
		// collinear control points IS the line), and curveBasis's internal
		// endpoint repetition makes the end tangent exactly the approach
		// direction. NOTE: do NOT repeat M manually — a duplicated final
		// control point renders a zero-length last segment, and
		// orient="auto" on a zero-length segment falls back to 0° (every
		// head pointing right).
		const Q = { x: M.x - ux * STRAIGHT_RUN, y: M.y - uy * STRAIGHT_RUN };
		pts.splice(pts.length - 1, 1, Q, M);
	}
	return edgeLine(pts) ?? "";
}

// ─── Status styling ──────────────────────────────────────────────────────────

// Rectangular boxes, white
// outlines/arrows/text; no fill on visited, today's gray look on upcoming,
// and the current node carries a faint yellow glow (a blurred yellow fill
// bleeding over the edges). The IN-CHAT block is monochrome white instead
// — no status language; the popup/window show the progression.
const BOX: Record<PlanNodeStatus, string> = {
	// 50%-opacity app background instead of true transparency: a routed
	// edge passing behind the box composites UNDER the fill — dimmed to
	// half, not shown straight through.
	visited: "fill-background/50 stroke-ink-max",
	current: "fill-background/50 stroke-ink-max",
	upcoming: "fill-card stroke-border",
};
const TEXT: Record<PlanNodeStatus, string> = {
	visited: "fill-ink-max text-xs",
	current: "fill-ink-max text-xs font-medium",
	upcoming: "fill-muted-foreground/80 text-xs",
};
// The in-chat block uses the dock look: boxes in the lighter background
// variant like the composer/dock shells, with white outlines.
const MONO_BOX = "fill-card stroke-ink-max";
const MONO_TEXT = "fill-foreground text-xs";

/** The diagram itself: positioned nodes + bezier edges. Pure-ish render —
 *  every input is data, so SSR render tests pin the whole thing. The root
 *  sets font-family var(--font-prose): node titles render in the READING
 *  font, not the mono UI font, and the runtime var
 *  rides the Appearance reading-font override (the utility can't: @theme
 *  inline bakes literals — the --font-title trap). */
function PlanDiagram({
	nodes,
	edges,
	statusOf,
	glowId,
	markerId,
	viewBoxOverride,
	pad: padUnits,
	textCapScale,
	naturalSize,
	monochrome,
	fill,
}: {
	nodes: readonly LayoutNode[];
	edges: ReadonlyArray<{ from: string; to: string }>;
	statusOf: (id: string) => PlanNodeStatus;
	glowId?: string | null;
	markerId: string;
	/** A windowed viewBox (the plan window) instead of the full extent. */
	viewBoxOverride?: string;
	/** Pads the viewBox by this many svg units so centered strokes and the
	 *  glow halo never clip at the extent edges (full-extent renders only). */
	pad?: number;
	/** Caps the rendered width at extent × scale — the chat-font-size zoom
	 *  ceiling for the in-chat block (fills the column, never past prose). */
	textCapScale?: number;
	/** Renders at the viewBox width in px (1 svg unit = 1 px at zoom 1) —
	 *  the popup's transform math depends on it; w-full inside the popup's
	 *  shrink-to-fit wrapper resolved to the popup width and broke fit. */
	naturalSize?: boolean;
	/** The in-chat block's mode: every node white (fill-none, white stroke
	 *  and text, no glow); statuses never show in the transcript. */
	monochrome?: boolean;
	/** Meet-fits the diagram inside a fixed box (h-full w-full — the svg's
	 *  default preserveAspectRatio centers + contains the viewBox): the
	 *  dock band's marginalia mode, where the diagram must fit BOTH the
	 *  flank's width and the band's height rather than run width-first. */
	fill?: boolean;
}) {
	const layout = useMemo(() => blockLayout(nodes, edges), [nodes, edges]);
	// Pad only the full-extent render — the plan window's override viewBox is
	// a deliberate viewport crop, and the popup keeps its own fit margins.
	const pad = viewBoxOverride ? 0 : (padUnits ?? 0);
	const w = Math.max(layout.width, 1);
	const h = Math.max(layout.height, 1);
	const vbW = w + 2 * pad;
	const vbH = h + 2 * pad;
	// The origin rides the ink extent: an arrow bulging past zero shifts
	// the viewBox with it instead of clipping.
	const ox = viewBoxOverride ? 0 : (layout.originX ?? 0);
	const oy = viewBoxOverride ? 0 : (layout.originY ?? 0);
	return (
		<svg
			viewBox={viewBoxOverride ?? `${ox - pad} ${oy - pad} ${vbW} ${vbH}`}
			className={`block ${fill ? "h-full w-full" : `h-auto${naturalSize ? "" : " w-full"}`}${textCapScale ? " mx-auto" : ""}`}
			style={{
				// The READING font via the runtime var, NOT
				// the font-prose utility: @theme inline bakes the literal into
				// utilities (the --font-title trap), which would freeze the
				// graph at Source Sans 3 and ignore the Appearance reading-font
				// override. var(--font-prose) rides it.
				fontFamily: "var(--font-prose)",
				...(textCapScale
					? { maxWidth: `${Math.round(vbW * textCapScale * 100) / 100}px` }
					: naturalSize
						? { width: `${vbW}px` }
						: {}),
			}}
			role="img"
			aria-label="Plan diagram"
		>
			<defs>
				<marker
					id={markerId}
					viewBox="0 0 50.2 104"
					refX={27.2}
					refY={52}
					markerWidth={HEAD_W}
					markerHeight={HEAD_H}
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					{/* The mouth (x 27.2) sits at refX so the
					    line ends AT the notch — the tip beyond it is solid fill. */}
					<path d={ARROW_HEAD} className="fill-ink-max" />
				</marker>
				{/* Same head, grayed — arrows into not-yet-visited nodes are
				    grayed out like the nodes themselves. */}
				<marker
					id={`${markerId}-dim`}
					viewBox="0 0 50.2 104"
					refX={27.2}
					refY={52}
					markerWidth={HEAD_W}
					markerHeight={HEAD_H}
					markerUnits="userSpaceOnUse"
					orient="auto"
				>
					<path d={ARROW_HEAD} className="fill-border" />
				</marker>
				{/* The current node's highlight: a faint yellow fill BLURRED so it
				    bleeds out over the node's edges. Generous filter region
				    so the blur never clips at its own bounds. */}
				<filter id={`${markerId}-glow`} x="-60%" y="-60%" width="220%" height="220%">
					<feGaussianBlur stdDeviation={GLOW_BLUR} />
				</filter>
			</defs>
			{edges.map((e) => {
				// Dagre's route for this edge: border-intersected waypoints —
				// the line leaves/enters nodes on whatever side dagre chose.
				// Unroutable edges
				// (dangling endpoints) draw nothing.
				const pts = layout.edgePts.get(`${e.from}->${e.to}`);
				if (!pts) return null;
				// The target's box — drives the docking gap + entry-angle clamp.
				const tx = layout.x.get(e.to);
				const ty = layout.y.get(e.to);
				const target =
					tx !== undefined && ty !== undefined
						? { x: tx, y: ty, w: layout.nodeW.get(e.to) ?? NODE_W_MIN, h: layout.nodeH.get(e.to) ?? NODE_H }
						: undefined;
				// An arrow is white only when BOTH its ends are white: a gray
				// box's outgoing arrows stay gray even when they point into
				// covered territory. The in-chat block stays all-white.
				const dim =
					!monochrome &&
					(statusOf(e.from) === "upcoming" || statusOf(e.to) === "upcoming");
				return (
					<path
						key={`${e.from}->${e.to}`}
						d={edgePathD(pts, target)}
						className={dim ? "fill-none stroke-border" : "fill-none stroke-ink-max"}
						strokeWidth={STROKE_W}
						markerEnd={`url(#${markerId}${dim ? "-dim" : ""})`}
					/>
				);
			})}
			{nodes.map((n) => {
				const status = statusOf(n.id);
				const glow = n.id === glowId && !monochrome;
				const lines = wrapTitle(n.title);
				// The box hugs its wrapped content; text centers in it both ways.
				const h = layout.nodeH.get(n.id) ?? NODE_H;
				const w = layout.nodeW.get(n.id) ?? NODE_W_MIN;
				const y0 = (h - lines.length * LINE_H) / 2 + 10;
				return (
					<g
						key={n.id}
						transform={`translate(${layout.x.get(n.id) ?? 0}, ${layout.y.get(n.id) ?? 0})`}
						data-testid={`plan-node-${n.id}`}
						data-status={status}
					>
						{/* Rectangular: no corner rounding. */}
						<rect
							width={w}
							height={h}
							className={monochrome ? MONO_BOX : BOX[status]}
							strokeWidth={STROKE_W}
						/>
						{glow && (
							// The current node's highlight: faint yellow, blurred so it
							// bleeds over the edges, static, no pulse. Paints ABOVE the
							// box fill so the fill doesn't dim the glow, while edges
							// behind the box still dim under that fill.
							<rect
								x={-GLOW_MARGIN}
								y={-GLOW_MARGIN}
								width={w + 2 * GLOW_MARGIN}
								height={h + 2 * GLOW_MARGIN}
								className="fill-yellow-400/25"
								filter={`url(#${markerId}-glow)`}
							/>
						)}
						{lines.map((line, i) => (
							<text
								key={i}
								x={w / 2}
								y={y0 + i * LINE_H}
								textAnchor="middle"
								className={monochrome ? MONO_TEXT : TEXT[status]}
							>
								{line}
							</text>
						))}
					</g>
				);
			})}
		</svg>
	);
}

// ─── The transcript block ─────────────────────────────────────────────────────

/**
 * A persisted plan-block part, rendered as carried (snapshot statuses,
 * never re-derived): borderless and column-filling, it opens the live plan
 * popup.
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
			className="block w-full text-left"
		>
			{/* pad keeps centered strokes + the glow halo inside the frame; the
		    cap keeps node text at or below chat prose size while still filling
		    the column when it can. */}
		<PlanDiagram
			nodes={data.nodes}
			edges={data.edges}
			statusOf={statusOf}
			markerId={markerId}
			pad={GRAPH_PAD}
			textCapScale={TEXT_CAP_SCALE}
			monochrome
		/>
		</button>
</Hint>
	);
}

// ─── The live plan popup ──────────────────────────────────────────────────────

// latestTree lives in plan-latest.ts (no dagre) so the lesson can read
// the plan without loading this module; re-exported for existing callers.
export { type PopupMessage } from "@/components/plan-latest";

/** The popup shows the glow, so its frame pads by the glow's reach —
 *  the in-chat block (monochrome, no glow) stays tight at GRAPH_PAD. */
const POPUP_PAD = GLOW_REACH;

/**
 * The full plan, live: latest tree + statuses derived at click time. Esc,
 * backdrop click, or the X close it; drag pans, wheel zooms to the cursor,
 * the zoom floor is the fit (panning locks at it — nothing to move).
 *
 * Session-scoped: it mounts absolute inside the chat page's session-area
 * div (chat.tsx), below the 60px drag bar and right of the sidebar, so the
 * top bar stays draggable and the X can never land in drag territory.
 * Surface 80% + blur: the transcript ghosts through.
 */
export function PlanPopup({
	messages,
	onClose,
	state = "open",
}: {
	messages: readonly PopupMessage[];
	onClose: () => void;
	/** Fade state: the caller keeps the popup mounted through its exit
	 *  with usePresence. */
	state?: "open" | "closed";
}) {
	const tree = useMemo(() => latestTree(messages), [messages]);
	const statuses = useMemo(
		() => (tree ? derivePlanStatuses(tree, messages as Parameters<typeof derivePlanStatuses>[1]) : null),
		[tree, messages],
	);
	const statusOf = (id: string): PlanNodeStatus => (statuses ? derivedNodeStatus(statuses, id) : "upcoming");

	// Esc closes, claimed at the DOCUMENT level: a surfaced layer's Esc is
	// exactly one action. The window-level chain (abort) is the fallback for when
	// NOTHING is surfaced; a window listener here could never stop it —
	// same-node listeners all fire.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const layout = useMemo(() => (tree ? blockLayout(tree.nodes, tree.edges) : null), [tree]);
	// The fit box is the PADDED ink box — the diagram renders with POPUP_PAD
	// (= the glow's reach) so the blurred glow never clips at the frame, and
	// the fit must account for that padding.
	const box = useMemo(
		() => (layout ? { w: layout.width + 2 * POPUP_PAD, h: layout.height + 2 * POPUP_PAD } : { w: 0, h: 0 }),
		[layout],
	);
	const { viewportRef, view, atFloor, settled, panning, startDrag, moveDrag, endDrag, stepZoom, fitView } = usePanZoomViewport(box, true);

	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");

	return (
		<div
			data-testid="plan-popup"
			// SESSION-SCOPED (absolute, not fixed): the chat page mounts this
			// INSIDE the session-area div — below the drag bar, right of the
			// sidebar. 80% + blur: the transcript ghosts through.
			className="absolute inset-0 z-40 flex flex-col bg-background/80 p-4 backdrop-blur-sm lh-fade"
			data-state={state}
			role="dialog"
			aria-modal="true"
			aria-label="The full plan"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="mb-2 flex items-center gap-2">
				<span className="text-sm font-medium">The plan</span>
				<span className="text-xs text-muted-foreground">live: statuses derive from your check outcomes</span>
				<Hint label="Close" side="left">
<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					data-testid="plan-popup-close"
					className="lh-press ml-auto p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<XIcon className="size-4" />
				</button>
</Hint>
			</div>
			<div
				ref={viewportRef}
				className={cn(
					"relative min-h-0 flex-1 touch-none overflow-hidden border select-none",
					atFloor ? "cursor-default" : "cursor-grab",
				)}
				onPointerDown={startDrag}
				onPointerMove={moveDrag}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				{tree ? (
					<>
						<div
							className="absolute top-0 left-0 origin-top-left"
							style={{
								transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
								// Hidden until the first fit has APPLIED — the fit runs in an
								// effect (after paint), so an opacity-gated chart can never flash
								// at the initial top-left zoom:1 state (same fix as the mermaid
								// overlay; transition-gating alone doesn't hide the fly-in).
								opacity: settled ? 1 : 0,
								transition:
									panning || !settled
										? "none"
										: "transform 180ms ease-out, opacity 160ms ease-out",
							}}
						>
							<PlanDiagram
								nodes={tree.nodes}
								edges={tree.edges}
								statusOf={statusOf}
								glowId={statuses?.current ?? null}
								markerId={markerId}
								pad={POPUP_PAD}
								naturalSize
							/>
						</div>
						<ZoomControls fitLabel="Fit plan to screen" fitTestId="plan-popup-fit" onStep={stepZoom} onFit={fitView} />
					</>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						No plan in this session yet.
					</div>
				)}
			</div>
		</div>
	);
}