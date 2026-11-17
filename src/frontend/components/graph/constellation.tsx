/**
 * The Graph picture: every fact a small square star, every topic a cluster of
 * them with its name under it, faint lines between topics that build on each
 * other. Pointing at a topic inks in its lines with arrows and dims the rest;
 * pointing at a star inks in the facts it builds on and leads to. A picture
 * taller than its box is drawn smaller (the SVG's viewBox); names shrink with
 * it until too small to read, then show only when lit, at full size; hover
 * boxes never shrink. It inks in as the tab opens.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { rampColor, type FactProgress, type GraphChain, type TopicLink, type TopicProgress } from "@/shared/core";
import { factCellLabel, factLinks, neighbors, topicCountLine } from "./derive.ts";
import { NAME_LINE, layoutSky, nameBox, restLines, type Cluster, type Rect, type Seg, type Sky, type Star } from "./constellation-layout.ts";
import { makeRouter } from "./constellation-routes.ts";
import { tipSpot } from "./constellation-tips.ts";
import { NAME_PX, fitPicture, namesHidden } from "./constellation-fit.ts";
import { NAME_AFTER, RIM_AFTER, frozenDelays, lineDelay, type Reveal } from "./constellation-reveal.ts";

/** Dimmed stars fade further than dimmed names, so names stay readable on the page. */
const DIM = 0.35;
const DIM_NAME = "color-mix(in srgb, var(--muted-foreground) 62%, var(--background))";
const ARROW = 7;
/** How near a star, and how far past a cluster's edge, the pointer reaches, in screen points. */
const HIT = 12;
const REACH = 8;
const TIP_W = 260;
const FADE = "var(--lh-dur) var(--lh-ease-out)";

let canvas: HTMLCanvasElement | null = null;
/** Name widths in the page's 13-point font. */
function measurer(): (t: string) => number {
	canvas ??= document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	// A DOM with no canvas (tests) gets a rough width per letter.
	if (!ctx) return (t) => t.length * 7;
	ctx.font = `${NAME_PX}px ${getComputedStyle(document.body).fontFamily}`;
	return (t) => ctx.measureText(t).width;
}

const fx = (n: number) => n.toFixed(1);

/** The lines as one path; `trim` stops each short of its end, where its arrowhead sits. */
function segPath(segs: readonly Seg[], trim = 0): string {
	return segs
		.map((g) => {
			const p = g.pts;
			const ex = p[p.length - 2]!;
			const ey = p[p.length - 1]!;
			let k = p.length - 2;
			while (k > 2 && Math.hypot(ex - p[k]!, ey - p[k + 1]!) < trim) k -= 2;
			let d = `M${fx(p[0]!)} ${fx(p[1]!)}`;
			for (let i = 2; i < k; i += 2) d += `L${fx(p[i]!)} ${fx(p[i + 1]!)}`;
			return `${d}L${fx(ex - g.ux * trim)} ${fx(ey - g.uy * trim)}`;
		})
		.join("");
}

/** A small solid arrowhead at each line's end, so "leads to" reads at a glance. */
function arrows(segs: readonly Seg[], len: number): string {
	return segs
		.map((g) => {
			const x2 = g.pts[g.pts.length - 2]!;
			const y2 = g.pts[g.pts.length - 1]!;
			const bx = x2 - g.ux * len;
			const by = y2 - g.uy * len;
			const w = len * 0.5;
			return `M${fx(x2)} ${fx(y2)}L${fx(bx - g.uy * w)} ${fx(by + g.ux * w)}L${fx(bx + g.uy * w)} ${fx(by - g.ux * w)}z`;
		})
		.join("");
}

function squares(stars: readonly Star[], s: number, grow = 0): string {
	const w = s + 2 * grow;
	return stars.map((t) => `M${t.x - grow} ${t.y - grow}h${w}v${w}h${-w}z`).join("");
}

/** One path per color, so a cluster is a handful of elements however many stars it has.
 *  In the reveal its core (the best known half) inks in first, then its rim. */
function ClusterStars({ k, s, keep, at }: { k: Cluster; s: number; keep: ReadonlySet<string> | null; at: number | null }) {
	const half = Math.ceil(k.stars.length / 2);
	const ring = (stars: readonly Star[], delay: number | null) => {
		const byColor = new Map<string, { full: Star[]; faint: Star[] }>();
		for (const st of stars) {
			const e = byColor.get(st.color) ?? byColor.set(st.color, { full: [], faint: [] }).get(st.color)!;
			(keep && !keep.has(st.id) ? e.faint : e.full).push(st);
		}
		const paths = [...byColor].map(([color, e]) => (
			<g key={color} fill={color}>
				{e.full.length > 0 && <path d={squares(e.full, s)} />}
				{e.faint.length > 0 && <path d={squares(e.faint, s)} opacity={0.3} />}
			</g>
		));
		return delay === null ? paths : <g className="lh-reveal" style={{ ["--lh-at" as string]: `${delay}ms` }}>{paths}</g>;
	};
	if (at === null) return ring(k.stars, null);
	return (
		<>
			{ring(k.stars.slice(0, half), at)}
			{ring(k.stars.slice(half), at + RIM_AFTER)}
		</>
	);
}

/** `reach` is in layout points: HIT / scale keeps it the same on screen. */
function nearestStar(sky: Sky, x: number, y: number, reach: number): Star | null {
	let best: Star | null = null;
	let bd = reach * reach;
	for (const st of sky.stars) {
		const d = (st.cx - x) ** 2 + (st.cy - y) ** 2;
		if (d < bd) {
			bd = d;
			best = st;
		}
	}
	return best;
}

function clusterAt(sky: Sky, x: number, y: number, reach: number): Cluster | null {
	return sky.clusters.find((k) => Math.hypot(k.cx - x, k.cy - y) <= k.r + reach) ?? null;
}

/** The topic and every topic it links to, both ways. */
function neighbourhood(id: string, links: readonly TopicLink[]): Set<string> {
	const s = new Set([id]);
	for (const l of links) {
		if (l.from === id) s.add(l.to);
		if (l.to === id) s.add(l.from);
	}
	return s;
}

/** "A", "A and B", "A, B and C". */
function names(ts: readonly TopicProgress[]): string {
	const n = ts.map((t) => t.name);
	return n.length < 2 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** What a screen reader hears on a topic: "Pointers, shaky, 13 facts, 2 of 3 right, needs Arrays, leads to Structs". */
function topicLabel(t: TopicProgress, links: readonly TopicLink[], byId: ReadonlyMap<string, TopicProgress>): string {
	const { needs, leadsTo } = neighbors(t.id, links, byId);
	return [
		t.name,
		t.status === "untested" ? "" : t.status,
		topicCountLine(t.members.length, t),
		needs.length ? `needs ${names(needs)}` : "",
		leadsTo.length ? `leads to ${names(leadsTo)}` : "",
	]
		.filter(Boolean)
		.join(", ");
}

const KEY_DIR: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The nearest topic from `k` in a direction, favouring ones straight ahead. */
function nextTopic(sky: Sky, k: Cluster, [dx, dy]: [number, number]): Cluster | null {
	let best: Cluster | null = null;
	let bs = Infinity;
	for (const o of sky.clusters) {
		const along = (o.cx - k.cx) * dx + (o.cy - k.cy) * dy;
		if (o === k || along <= 0) continue;
		const score = along + 2 * Math.abs((o.cx - k.cx) * dy - (o.cy - k.cy) * dx);
		if (score < bs) {
			bs = score;
			best = o;
		}
	}
	return best;
}

/** A name's box in layout points; `full` is a lit name drawn at full size
 *  on a scaled-down picture, centred under its cluster. */
function shownName(k: Cluster, scale: number, full: boolean): Rect {
	const b = nameBox(k);
	if (!full) return b;
	const half = k.textW / scale / 2;
	return { x0: k.cx - half, x1: k.cx + half, y0: b.y0, y1: b.y0 + (k.text.length * NAME_LINE) / scale };
}

export function Constellation({
	topics,
	links,
	facts,
	chains,
	width,
	height,
	reveal,
	pickedId,
	pickedFactId,
	focus,
	factMatches,
	onPick,
	onPickFact,
}: {
	topics: readonly TopicProgress[];
	links: readonly TopicLink[];
	facts: readonly FactProgress[];
	/** Fact chains; null while they load. */
	chains: readonly Pick<GraphChain, "premises" | "conclusion">[] | null;
	/** The room the picture gets. */
	width: number;
	/** The most height it may take: a taller picture scales down evenly to fit. */
	height: number;
	/** This opening's reveal while it runs; null once the picture is in. */
	reveal: Reveal | null;
	pickedId: string | null;
	pickedFactId: string | null;
	/** Topics Find keeps lit; null with nothing typed. */
	focus: ReadonlySet<string> | null;
	/** Facts Find matched; null with nothing typed. */
	factMatches: ReadonlySet<string> | null;
	/** A topic, or null for a click on empty picture. */
	onPick: (topicId: string | null) => void;
	onPickFact: (factId: string) => void;
}) {
	// Names are measured in the loaded font, so lay out again once it is in.
	const [fontsIn, setFontsIn] = useState(false);
	useEffect(() => {
		let live = true;
		// A DOM without font loading (tests) keeps the first measure.
		void document.fonts?.ready.then(() => live && setFontsIn(true));
		return () => {
			live = false;
		};
	}, []);
	// fontsIn is here so the names are measured again once the font is in.
	const measure = useMemo(() => measurer(), [fontsIn]);
	const { sky, scale, router, rest } = useMemo(() => {
		const { sky, scale } = fitPicture((w) => layoutSky(topics, links, facts, w, measure), { width, height });
		const router = makeRouter(sky);
		return { sky, scale, router, rest: restLines(sky, links, (a, z) => router.link(a, z, null, false)) };
	}, [topics, links, facts, width, height, measure]);
	const tiny = namesHidden(scale);
	// Fixed for this mount: a re-fit never moves a running animation, and a
	// remount mid-reveal starts each one where it would be by now.
	const [opening] = useState(() => (reveal ? { at: frozenDelays(reveal, sky), elapsed: performance.now() - reveal.start } : null));
	const inAt = reveal ? opening : null;
	const startOf = (id: string) => {
		const at = inAt?.at.get(id);
		return at === undefined ? undefined : at - inAt!.elapsed;
	};
	// Work out every lit line in the background so the first hover is instant too, in slices of about 8 ms so the page never stalls.
	useEffect(() => {
		const drawn = (id: string) => sky.byTopic.get(id)?.muted === false;
		const jobs = links.filter((l) => l.from !== l.to && drawn(l.from) && drawn(l.to)).flatMap((l) => [l.from, l.to].map((lead) => [l, lead] as const));
		let i = 0;
		let timer = 0;
		const step = () => {
			const end = performance.now() + 8;
			do {
				const job = jobs[i++];
				if (!job) return;
				router.link(job[0].from, job[0].to, job[1], true);
			} while (performance.now() < end);
			timer = window.setTimeout(step, 0);
		};
		timer = window.setTimeout(step, 300);
		return () => window.clearTimeout(timer);
	}, [sky, router, links]);
	const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
	const labels = useMemo(() => new Map(topics.map((t) => [t.id, topicLabel(t, links, topicById)])), [topics, links, topicById]);
	const factById = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);

	const [hoverId, setHoverId] = useState<string | null>(null);
	const [ptrStar, setPtrStar] = useState<string | null>(null);
	// The fact open in its panel stays marked with its chains inked; a pointed-at star takes over.
	const starId = ptrStar ?? pickedFactId;
	const star = starId ? (sky.starById.get(starId) ?? null) : null;

	const starLinks = useMemo(() => {
		if (!star) return null;
		const { buildsOn, leadsTo } = factLinks(star.id, chains ?? []);
		const ends: Star[] = [];
		const segs: Seg[] = [];
		const add = (a: string, z: string, other: string) => {
			const end = sky.starById.get(other);
			if (!end) return;
			ends.push(end);
			// A chain whose two stars nearly touch keeps its marked end star and needs no line.
			const g = router.chain(a, z);
			if (g) segs.push(g);
		};
		for (const id of buildsOn) add(id, star.id, id);
		for (const id of leadsTo) add(star.id, id, id);
		return { segs, ends, topics: new Set([star.topicId, ...ends.map((e) => e.topicId)]) };
	}, [star, chains, sky, router]);

	// One topic leads: the hovered one, else the picked one. Its lines ink in.
	const lead = star ? null : (hoverId ?? pickedId);
	const lit = useMemo(() => {
		const base = starLinks ? starLinks.topics : hoverId ? neighbourhood(hoverId, links) : (focus ?? (pickedId ? neighbourhood(pickedId, links) : null));
		// The picked topic never dims.
		return base && pickedId && !base.has(pickedId) ? new Set([...base, pickedId]) : base;
	}, [starLinks, hoverId, focus, pickedId, links]);
	const inked = useMemo(() => {
		if (!lead || sky.byTopic.get(lead)?.muted !== false) return [];
		const grouped = (id: string) => sky.byTopic.get(id)?.muted === false;
		return links
			.filter((l) => (l.from === lead || l.to === lead) && l.from !== l.to && grouped(l.from) && grouped(l.to))
			.map((l) => router.link(l.from, l.to, hoverId === lead ? lead : null, true))
			// A link listed twice gives the same remembered line; draw it once.
			.filter((g, i, all): g is Seg => !!g && all.indexOf(g) === i);
	}, [lead, links, sky, router, hoverId]);

	// Find: inside a topic found by its facts, only the matching stars stay full ink.
	const { keep, found } = useMemo(() => {
		if (!factMatches || !focus) return { keep: null, found: [] as Star[] };
		const keep = new Set<string>();
		const found: Star[] = [];
		for (const k of sky.clusters) {
			const hits = k.stars.filter((s) => factMatches.has(s.id));
			for (const s of hits.length ? hits : k.stars) keep.add(s.id);
			if (hits.length && hits.length < k.stars.length) found.push(...hits);
		}
		return { keep, found };
	}, [factMatches, focus, sky]);

	// Roving focus: one Tab stop among the topics, arrow keys move between them.
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const [tabId, setTabId] = useState<string | null>(null);
	// A topic picked anywhere, a chip in its panel too, becomes the Tab stop.
	useEffect(() => {
		if (pickedId) setTabId(pickedId);
	}, [pickedId]);
	const first = useMemo(() => [...sky.clusters].sort((a, b) => a.cx - b.cx || a.cy - b.cy)[0]?.topic.id ?? null, [sky]);
	const stop = [tabId, pickedId].find((id) => id && sky.byTopic.has(id)) ?? first;
	const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: Cluster) => {
		const dir = KEY_DIR[e.key];
		if (!dir) return;
		e.preventDefault();
		const next = nextTopic(sky, k, dir);
		if (!next) return;
		setTabId(next.topic.id);
		buttons.current.get(next.topic.id)?.focus();
	};

	// The pointer in layout points, whatever the scale.
	const local = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
	};
	const onMove = (e: PointerEvent<HTMLDivElement>) => {
		// Over a name, its button sets the hover itself.
		if (e.target instanceof Element && e.target.closest("[data-topic-id]")) return setPtrStar(null);
		const { x, y } = local(e);
		const st = nearestStar(sky, x, y, HIT / scale);
		setPtrStar(st?.id ?? null);
		setHoverId(st ? null : (clusterAt(sky, x, y, REACH / scale)?.topic.id ?? null));
	};
	const onLeave = () => {
		setPtrStar(null);
		setHoverId(null);
	};
	// Names are buttons with their own click; this is stars, clusters and empty picture.
	const onClick = (e: MouseEvent<HTMLDivElement>) => {
		const { x, y } = local(e);
		const st = nearestStar(sky, x, y, HIT / scale);
		if (st) onPickFact(st.id);
		else onPick(clusterAt(sky, x, y, REACH / scale)?.topic.id ?? null);
	};

	const pointed = star && ptrStar ? factById.get(star.id) : undefined;
	// Hover boxes sit where they cover neither the hovered thing nor what it lights.
	const starTip = useMemo(() => {
		if (!star || !pointed || !starLinks) return null;
		const nameW = measure(pointed.name);
		const w = Math.min(TIP_W, Math.max(nameW, (measure(factCellLabel(pointed)) * 12) / 13) + 34);
		const h = 50 + Math.ceil(nameW / (TIP_W - 34)) * 20;
		const at: Rect = { x0: star.x - 3, y0: star.y - 3, x1: star.x + sky.s + 3, y1: star.y + sky.s + 3 };
		const spot = tipSpot(sky, at, w / scale, h / scale, 8 / scale, starLinks.topics, starLinks.segs);
		return { w, left: spot.left * scale, top: spot.top * scale };
	}, [star, pointed, starLinks, sky, measure, scale]);
	const hovered = hoverId && !star ? sky.byTopic.get(hoverId) : undefined;
	const topicTip = useMemo(() => {
		if (!hovered) return null;
		const spot = tipSpot(sky, shownName(hovered, scale, tiny), hovered.tipW / scale, 16 / scale, 6 / scale, lit ?? new Set([hovered.topic.id]), inked);
		return { left: spot.left * scale, top: spot.top * scale };
	}, [hovered, sky, lit, inked, scale, tiny]);

	const shownW = sky.width * scale;
	const shownH = sky.height * scale;
	return (
		<div
			data-testid="graph-picture"
			className="relative select-none"
			style={{ width: shownW, height: shownH, cursor: star || hoverId ? "pointer" : "default" }}
			onPointerMove={onMove}
			onPointerLeave={onLeave}
			onClick={onClick}
		>
			<svg aria-hidden width={shownW} height={shownH} viewBox={`0 0 ${sky.width} ${sky.height}`} className="absolute inset-0 overflow-visible">
				{inAt ? (
					<g fill="none" stroke="var(--foreground)" strokeOpacity={lit ? 0.07 : 0.17} strokeWidth={1.25}>
						{rest.map((g) => (
							<path key={`${g.from}>${g.to}`} d={segPath([g])} pathLength={1} className="lh-reveal-line" style={{ ["--lh-at" as string]: `${lineDelay(g, inAt.at) - inAt.elapsed}ms` }} />
						))}
					</g>
				) : (
					<path d={segPath(rest)} fill="none" stroke="var(--foreground)" strokeOpacity={lit ? 0.07 : 0.17} strokeWidth={1.25} style={{ transition: `stroke-opacity ${FADE}` }} />
				)}
				{inked.length > 0 && (
					<g className="lh-fade">
						<path d={segPath(inked, ARROW - 1)} fill="none" stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1.5} />
						<path d={arrows(inked, ARROW)} fill="var(--foreground)" fillOpacity={0.8} />
					</g>
				)}
				{sky.clusters.map((k) => (
					<g key={k.topic.id} shapeRendering="crispEdges" opacity={lit && !lit.has(k.topic.id) ? DIM : 1} style={{ transition: `opacity ${FADE}` }}>
						<ClusterStars k={k} s={sky.s} keep={keep} at={startOf(k.topic.id) ?? null} />
					</g>
				))}
				{found.length > 0 && <path shapeRendering="crispEdges" d={squares(found, sky.s)} fill="var(--foreground)" />}
				{star && starLinks && (
					<g className="lh-fade">
						<path d={segPath(starLinks.segs, 4)} fill="none" stroke="var(--foreground)" strokeOpacity={0.75} strokeWidth={1} />
						<path d={arrows(starLinks.segs, 5)} fill="var(--foreground)" fillOpacity={0.85} />
						{/* A chain's other ends grow in their own color; the star itself grows inside a solid 2-point ink frame. */}
						<g shapeRendering="crispEdges">
							{starLinks.ends.map((e) => (
								<path key={e.id} d={squares([e], sky.s, 2)} fill={e.color} />
							))}
							<path d={squares([star], sky.s, 4)} fill="var(--foreground)" />
							<path d={squares([star], sky.s, 2)} fill={star.color} />
						</g>
					</g>
				)}
			</svg>
			{sky.clusters.map((k) => {
				const id = k.topic.id;
				const picked = id === pickedId;
				const dim = lit && !lit.has(id);
				// Too small to read at rest: not drawn until pointed at, picked, lit or found.
				const shown = !tiny || hoverId === id || picked || !!lit?.has(id);
				const box = shownName(k, scale, tiny && shown);
				const size = tiny && shown ? 1 : scale;
				const at = startOf(id);
				return (
					<button
						key={id}
						ref={(el) => {
							if (el) buttons.current.set(id, el);
							else buttons.current.delete(id);
						}}
						type="button"
						data-testid="graph-topic"
						data-topic-id={id}
						aria-label={labels.get(id)}
						aria-pressed={picked}
						data-dim={dim ? true : undefined}
						tabIndex={id === stop ? 0 : -1}
						onClick={(e) => {
							e.stopPropagation();
							setTabId(id);
							onPick(id);
						}}
						onKeyDown={(e) => onKey(e, k)}
						onPointerEnter={() => setHoverId(id)}
						onFocus={() => setHoverId(id)}
						onBlur={() => setHoverId(null)}
						className={at === undefined ? "absolute block text-center" : "lh-reveal absolute block text-center"}
						style={{
							left: Math.max(0, Math.min(shownW - (box.x1 - box.x0) * scale, box.x0 * scale)),
							top: box.y0 * scale,
							width: (box.x1 - box.x0) * scale,
							fontSize: NAME_PX * size,
							lineHeight: `${NAME_LINE * size}px`,
							// Hidden, it lets the pointer through to the stars; it stays focusable.
							opacity: shown ? undefined : 0,
							pointerEvents: shown ? undefined : "none",
							zIndex: tiny && shown ? 10 : undefined,
							transition: `color ${FADE}`,
							color: dim ? DIM_NAME : k.muted ? "var(--lh-ink-3)" : hoverId === id || picked ? "var(--foreground)" : "var(--muted-foreground)",
							["--lh-at" as string]: at === undefined ? undefined : `${at + NAME_AFTER}ms`,
						}}
					>
						<span
							aria-hidden
							className="inline-block whitespace-nowrap align-top"
							style={picked ? { paddingBottom: 3 * size, borderBottom: "2px solid var(--foreground)" } : undefined}
						>
							{k.text.map((ln, i) => (
								<span key={i} className="block">
									{/* A tested topic's name starts with a square in its status color. */}
									{i === 0 && k.topic.status !== "untested" && !k.muted && (
										<span className="inline-block align-[0px]" style={{ width: 9 * size, height: 9 * size, marginRight: 5 * size, background: rampColor(k.topic.rate), opacity: dim ? 0.5 : 1, transition: `opacity ${FADE}` }} />
									)}
									{ln}
								</span>
							))}
						</span>
					</button>
				);
			})}
			{/* The score inks in near the name: no box over the picture. */}
			{hovered && topicTip && (
				<span
					key={hovered.topic.id}
					aria-hidden
					className="lh-fade pointer-events-none absolute whitespace-nowrap text-xs leading-4 text-muted-foreground"
					style={{ left: topicTip.left, top: topicTip.top }}
				>
					{topicCountLine(hovered.topic.members.length, hovered.topic)}
				</span>
			)}
			{pointed && starTip && (
				<div aria-hidden className="lh-fade pointer-events-none absolute z-20 flex" style={{ left: starTip.left, top: starTip.top, width: starTip.w }}>
					<div className="lh-sheet flex w-full flex-col gap-1 px-3.5 pt-2.5 pb-3.5">
						<div className="text-sm text-foreground">{pointed.name}</div>
						<div className="text-xs text-muted-foreground">{factCellLabel(pointed)}</div>
					</div>
				</div>
			)}
		</div>
	);
}
