/**
 * THE TOPIC MAP (redesign plan, Phase 5): an SVG of the class's topics on
 * a dot grid, foundations on the left. Pan and zoom with d3-zoom (the
 * camera is applied straight to the DOM — panning never re-renders React).
 * The layout is computed once per data change (layout.ts, cached by its
 * key). Hovering or focusing a topic lights its arrows and shows its
 * tooltip; clicking selects it; clicking the empty map clears it.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { RAMP_COLORS, type TopicLink, type TopicProgress } from "@/core";
import { fitTransform, layoutKey, layoutTopics, MAX_SCALE, MIN_SCALE, type PlacedLink, type TopicLayout } from "./layout.ts";
import { neighbors } from "./derive.ts";
import { FADED_OPACITY, TopicNode } from "./topic-node.tsx";
import { MapTooltip } from "./map-tooltip.tsx";

const TOOLTIP_WIDTH = 232;

export interface TopicMapProps {
	topics: readonly TopicProgress[];
	links: readonly TopicLink[];
	/** The topics that stay bright (on the picked deadline, matching the
	 *  search); every other topic fades. null = all bright. */
	focus: ReadonlySet<string> | null;
	selectedId: string | null;
	onSelect: (id: string | null) => void;
}

export function TopicMap({ topics, links, focus, selectedId, onSelect }: TopicMapProps) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const viewRef = useRef<SVGGElement>(null);
	const dotsRef = useRef<SVGPatternElement>(null);
	const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
	const transformRef = useRef<ZoomTransform>(zoomIdentity);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [hoverId, setHoverId] = useState<string | null>(null);

	// The layout, cached by what it depends on (a progress refresh with the
	// same topics, columns, sizes and arrows reuses it).
	const layoutInput = useMemo(
		() => ({
			topics: topics.map((t) => ({ id: t.id, column: t.column, size: t.members.length })),
			links: links.map((l) => ({ from: l.from, to: l.to })),
		}),
		[topics, links],
	);
	const key = layoutKey(layoutInput.topics, layoutInput.links);
	// Keyed on the layout key: same columns, sizes and arrows → same layout.
	const layout = useMemo(() => layoutTopics(layoutInput.topics, layoutInput.links), [key]);
	const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
	// Tab order follows the map: left to right, top to bottom.
	const ordered = useMemo(
		() => [...layout.topics].sort((a, b) => a.x - b.x || a.y - b.y).filter((p) => byId.has(p.id)),
		[layout, byId],
	);

	const applyTransform = useCallback((t: ZoomTransform) => {
		transformRef.current = t;
		const s = t.toString();
		viewRef.current?.setAttribute("transform", s);
		dotsRef.current?.setAttribute("patternTransform", s);
	}, []);

	// d3-zoom: wheel zooms to the cursor, drag pans; no double-click zoom.
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const behavior = zoom<SVGSVGElement, unknown>()
			.scaleExtent([MIN_SCALE, MAX_SCALE])
			.on("zoom", (event: { transform: ZoomTransform; sourceEvent: unknown }) => {
				applyTransform(event.transform);
				if (event.sourceEvent) setHoverId(null);
			});
		zoomRef.current = behavior;
		const selection = select(svg);
		selection.call(behavior).on("dblclick.zoom", null);
		return () => {
			selection.on(".zoom", null);
			zoomRef.current = null;
		};
	}, [applyTransform]);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return;
			setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Fit the map whenever the layout changes (and once the size is known).
	const hasSize = size.w > 0 && size.h > 0;
	useLayoutEffect(() => {
		const svg = svgRef.current;
		const behavior = zoomRef.current;
		if (!svg || !behavior || !hasSize || layout.topics.length === 0) return;
		const box = wrapRef.current!.getBoundingClientRect();
		const fit = fitTransform(layout.bounds, { w: box.width, h: box.height });
		select(svg).call(behavior.transform, zoomIdentity.translate(fit.x, fit.y).scale(fit.k));
		setHoverId(null);
		// Refit on a new layout (not on every resize: the learner's camera stays).
	}, [layout, hasSize]);

	const hover = hoverId ? byId.get(hoverId) : undefined;
	const tooltip = hover && hover.id !== selectedId ? tooltipPlace(layout, hover.id, transformRef.current, size) : null;
	const hoverNeighbors = useMemo(() => (hover ? neighbors(hover.id, [...links], byId) : null), [hover, links, byId]);

	return (
		<div ref={wrapRef} data-testid="topic-map" className="relative h-full min-w-0 flex-1 overflow-hidden bg-background">
			<svg ref={svgRef} className="absolute inset-0 size-full touch-none select-none" aria-label="Topic map">
				<MapDefs dotsRef={dotsRef} />
				<rect width="100%" height="100%" fill="url(#topic-dots)" pointerEvents="none" />
				<rect width="100%" height="100%" fill="url(#topic-vignette)" pointerEvents="none" />
				<rect data-testid="topic-map-bg" width="100%" height="100%" fill="transparent" onClick={() => onSelect(null)} />
				<g ref={viewRef}>
					<BaseLinks links={layout.links} focus={focus} />
					<LitLinks links={layout.links} id={selectedId} tone="selected" />
					{hoverId !== selectedId && <LitLinks links={layout.links} id={hoverId} tone="hover" />}
					{ordered.map((place) => (
						<TopicNode
							key={place.id}
							topic={byId.get(place.id)!}
							place={place}
							faded={!!focus && !focus.has(place.id)}
							hovered={hoverId === place.id}
							selected={selectedId === place.id}
							onHover={setHoverId}
							onSelect={onSelect}
						/>
					))}
				</g>
			</svg>
			{topics.length === 0 ? (
				<p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-ink-3">
					Start a lesson or import notes to build your graph.
				</p>
			) : (
				<>
					<span className="pointer-events-none absolute left-6 top-[22px] text-[12.5px] font-bold text-ink-3">Foundations</span>
					<span className="pointer-events-none absolute right-6 top-[22px] text-[12.5px] font-bold text-ink-3">Advanced →</span>
					<MapLegend />
				</>
			)}
			{hover && tooltip && hoverNeighbors && (
				<MapTooltip topic={hover} needs={hoverNeighbors.needs} leadsTo={hoverNeighbors.leadsTo} style={tooltip} />
			)}
		</div>
	);
}

/** Beside the ring (right, or left when it would leave the map). */
function tooltipPlace(layout: TopicLayout, id: string, t: ZoomTransform, size: { w: number; h: number }): React.CSSProperties | null {
	const p = layout.byId.get(id);
	if (!p) return null;
	const [sx, sy] = t.apply([p.x, p.y]);
	const r = (p.d / 2) * t.k;
	let left = sx + r + 14;
	if (size.w > 0 && left + TOOLTIP_WIDTH > size.w - 8) left = Math.max(8, sx - r - 14 - TOOLTIP_WIDTH);
	const top = size.h > 0 ? Math.min(Math.max(8, sy - 24), Math.max(8, size.h - 170)) : sy - 24;
	return { left, top };
}

function MapDefs({ dotsRef }: { dotsRef: React.RefObject<SVGPatternElement | null> }) {
	return (
		<defs>
			<pattern ref={dotsRef} id="topic-dots" width={24} height={24} patternUnits="userSpaceOnUse">
				<rect x={12} y={12} width={1.2} height={1.2} fill="#FFFFFF14" />
			</pattern>
			<radialGradient id="topic-vignette" cx={0.5} cy={0.45} r={0.65} gradientTransform="translate(0.5 0.45) scale(1 0.92) translate(-0.5 -0.45)">
				<stop offset={0.45} stopColor="#000" stopOpacity={0} />
				<stop offset={1} stopColor="#000" stopOpacity={0.9} />
			</radialGradient>
			{RAMP_COLORS.map((c, i) => (
				<radialGradient key={c} id={`topic-halo-${i}`}>
					<stop offset={0} stopColor={c} stopOpacity={0.19} />
					<stop offset={1} stopColor={c} stopOpacity={0} />
				</radialGradient>
			))}
			<filter id="topic-link-glow" x="-10%" y="-10%" width="120%" height="120%">
				<feGaussianBlur stdDeviation={3} result="blur" />
				<feMerge>
					<feMergeNode in="blur" />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>
		</defs>
	);
}

const BaseLinks = memo(function BaseLinks({ links, focus }: { links: readonly PlacedLink[]; focus: ReadonlySet<string> | null }) {
	return (
		<g data-testid="topic-links">
			{links.map((l) => {
				const dim = !!focus && (!focus.has(l.from) || !focus.has(l.to));
				return (
					<g key={`${l.from}>${l.to}`} opacity={dim ? FADED_OPACITY : 1}>
						<path d={l.path} fill="none" stroke="#FFFFFF24" strokeWidth={1} vectorEffect="non-scaling-stroke" />
						<polygon points={l.arrow} fill="#FFFFFF4D" />
					</g>
				);
			})}
		</g>
	);
});

function LitLinks({ links, id, tone }: { links: readonly PlacedLink[]; id: string | null; tone: "hover" | "selected" }) {
	if (!id) return null;
	const lit = links.filter((l) => l.from === id || l.to === id);
	if (lit.length === 0) return null;
	const color = tone === "selected" ? "#FFFFFFD9" : "#FFFFFFB3";
	return (
		<g data-testid={`topic-links-${tone}`} filter={tone === "selected" ? "url(#topic-link-glow)" : undefined}>
			{lit.map((l) => (
				<g key={`${l.from}>${l.to}`}>
					<path d={l.path} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
					<polygon points={l.arrow} fill={color} />
				</g>
			))}
		</g>
	);
}

function MapLegend() {
	return (
		<div className="pointer-events-none absolute bottom-6 left-6 flex items-center gap-5 text-xs text-ink-3">
			<span className="flex items-center gap-[5px]">
				{RAMP_COLORS.map((c) => (
					<span key={c} className="h-1 w-3.5" style={{ background: c }} />
				))}
				<span className="ml-1.5">wrong → right</span>
			</span>
			<span>A → B learn A first</span>
		</div>
	);
}
