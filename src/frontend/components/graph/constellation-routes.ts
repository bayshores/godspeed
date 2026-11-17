/**
 * How the Graph picture's lines run. A line never crosses a name or another
 * cluster: it tries one gentle curve first, and a lit line that finds none
 * takes a detour through the gaps (a grid search, pulled tight and rounded).
 * A rest line with no gentle curve is not drawn; a lit line always is. Pure;
 * every route is worked out once and remembered.
 */
import { nameBox, type Cluster, type Rect, type Seg, type Sky, type Star } from "./constellation-layout.ts";

interface Router {
	/** A topic link. `lead` is the hovered topic, whose score line shows under its name. `lit` lines may bend further and detour. */
	link: (from: string, to: string, lead: string | null, lit: boolean) => Seg | null;
	/** A fact chain between two stars. */
	chain: (from: string, to: string) => Seg | null;
}

interface Grid {
	G: number;
	cols: number;
	rows: number;
	nameCell: Uint8Array;
	discCell: Int16Array;
}

interface Obstacles {
	discs: { x: number; y: number; r: number }[];
	boxes: Rect[];
}

/** A name's box with room around its ink, so no line runs close along it; `tall` also holds the score line under it. */
function nameRect(k: Cluster, tall = false): Rect {
	const b = nameBox(tall ? { ...k, textW: Math.min(Math.max(k.textW, k.tipW), k.textW + 30) } : k);
	return { x0: b.x0 - 6, x1: b.x1 + 6, y0: b.y0 + 1, y1: b.y1 + (tall ? 20 : 5) };
}

/** Points no more than `step` apart along a polyline. */
function dense(pts: number[], step = 3): number[] {
	const out = [pts[0]!, pts[1]!];
	for (let i = 2; i < pts.length; i += 2) {
		const x0 = pts[i - 2]!;
		const y0 = pts[i - 1]!;
		const n = Math.max(1, Math.ceil(Math.hypot(pts[i]! - x0, pts[i + 1]! - y0) / step));
		for (let j = 1; j <= n; j++) out.push(x0 + ((pts[i]! - x0) * j) / n, y0 + ((pts[i + 1]! - y0) * j) / n);
	}
	return out;
}

/** Cut a centre-to-centre line where it leaves the start's ring and enters the end's ring. */
function trimEnds(pts: number[], ax: number, ay: number, ga: number, zx: number, zy: number, gz: number): number[] | null {
	let i = 0;
	while (i < pts.length && Math.hypot(pts[i]! - ax, pts[i + 1]! - ay) < ga) i += 2;
	let j = pts.length - 2;
	while (j >= 0 && Math.hypot(pts[j]! - zx, pts[j + 1]! - zy) < gz) j -= 2;
	return i >= j ? null : pts.slice(i, j + 2);
}

function seg(from: string, to: string, pts: number[]): Seg {
	const n = pts.length;
	let k = n - 4;
	while (k > 0 && Math.hypot(pts[n - 2]! - pts[k]!, pts[n - 1]! - pts[k + 1]!) < 6) k -= 2;
	const ex = pts[n - 2]! - pts[k]!;
	const ey = pts[n - 1]! - pts[k + 1]!;
	const e = Math.hypot(ex, ey) || 1;
	return { from, to, pts, ux: ex / e, uy: ey / e };
}

/** A cubic from a to z with control points c1 and c2, sampled every 3 points or so. */
function bezier(ax: number, ay: number, c1x: number, c1y: number, c2x: number, c2y: number, zx: number, zy: number, n: number): number[] {
	const pts: number[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const u = 1 - t;
		pts.push(u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * zx, u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * zy);
	}
	return pts;
}

/** A smooth curve through a detour's turning points. Centripetal Catmull-Rom never loops or kinks. */
function smooth(p: number[]): number[] {
	const n = p.length / 2;
	if (n < 3) return dense(p);
	const pt = (i: number): [number, number] => {
		if (i < 0) return [2 * p[0]! - p[2]!, 2 * p[1]! - p[3]!];
		if (i >= n) return [2 * p[2 * n - 2]! - p[2 * n - 4]!, 2 * p[2 * n - 1]! - p[2 * n - 3]!];
		return [p[2 * i]!, p[2 * i + 1]!];
	};
	const lerp = (a: [number, number], b: [number, number], ta: number, tb: number, x: number): [number, number] => [
		((tb - x) / (tb - ta)) * a[0] + ((x - ta) / (tb - ta)) * b[0],
		((tb - x) / (tb - ta)) * a[1] + ((x - ta) / (tb - ta)) * b[1],
	];
	const out: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		const P = [pt(i - 1), pt(i), pt(i + 1), pt(i + 2)] as const;
		const t = [0];
		for (let k = 1; k < 4; k++) t.push(t[k - 1]! + Math.max(1e-3, Math.sqrt(Math.hypot(P[k]![0] - P[k - 1]![0], P[k]![1] - P[k - 1]![1]))));
		const m = Math.max(2, Math.ceil(Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]) / 3));
		for (let j = i === 0 ? 0 : 1; j <= m; j++) {
			const x = t[1]! + ((t[2]! - t[1]!) * j) / m;
			const A1 = lerp(P[0], P[1], t[0]!, t[1]!, x);
			const A2 = lerp(P[1], P[2], t[1]!, t[2]!, x);
			const A3 = lerp(P[2], P[3], t[2]!, t[3]!, x);
			out.push(...lerp(lerp(A1, A2, t[0]!, t[2]!, x), lerp(A2, A3, t[1]!, t[3]!, x), t[1]!, t[2]!, x));
		}
	}
	return out;
}

/** A detour's corners cut off twice, each cut a quarter in from both ends of a side; stays inside the corners, so it keeps the detour's clearance. */
function rounded(p: number[]): number[] {
	let q = p;
	for (let pass = 0; pass < 2; pass++) {
		const out = [q[0]!, q[1]!];
		for (let i = 0; i < q.length - 2; i += 2) {
			const [x0, y0, x1, y1] = [q[i]!, q[i + 1]!, q[i + 2]!, q[i + 3]!];
			if (i > 0) out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1);
			if (i < q.length - 4) out.push(0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
		}
		out.push(q[q.length - 2]!, q[q.length - 1]!);
		q = out;
	}
	return dense(q);
}

/** A detour with each corner rounded over at most `rad` points: hugs the detour closest, for a way through with little room. */
function filleted(p: number[], rad: number): number[] {
	const out = [p[0]!, p[1]!];
	for (let i = 2; i < p.length - 2; i += 2) {
		const [px, py] = [p[i]!, p[i + 1]!];
		const la = Math.hypot(p[i - 2]! - px, p[i - 1]! - py) || 1;
		const lb = Math.hypot(p[i + 2]! - px, p[i + 3]! - py) || 1;
		const c = Math.min(rad, la / 2, lb / 2);
		const [ax, ay] = [px + ((p[i - 2]! - px) / la) * c, py + ((p[i - 1]! - py) / la) * c];
		const [bx, by] = [px + ((p[i + 2]! - px) / lb) * c, py + ((p[i + 3]! - py) / lb) * c];
		for (let j = 0; j <= 4; j++) {
			const t = j / 4;
			out.push((1 - t) ** 2 * ax + 2 * (1 - t) * t * px + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * py + t * t * by);
		}
	}
	out.push(p[p.length - 2]!, p[p.length - 1]!);
	return dense(out);
}

/** How much a line turns along its length, in radians, read every 12 points so small steps do not count: a hump or an S scores high. */
function turning(p: number[]): number {
	const at: [number, number][] = [[p[0]!, p[1]!]];
	for (let i = 2; i < p.length; i += 2) {
		const [x, y] = at[at.length - 1]!;
		if (Math.hypot(p[i]! - x, p[i + 1]! - y) >= 12 || i === p.length - 2) at.push([p[i]!, p[i + 1]!]);
	}
	let sum = 0;
	for (let i = 2; i < at.length; i++) {
		const a = Math.atan2(at[i - 1]![1] - at[i - 2]![1], at[i - 1]![0] - at[i - 2]![0]);
		const b = Math.atan2(at[i]![1] - at[i - 1]![1], at[i]![0] - at[i - 1]![0]);
		sum += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
	}
	return sum;
}

/** One cubic whose handles reach toward a detour's first and last turns. */
function handles(p: number[], k1: number, k2: number): number[] {
	const n = p.length;
	const [ax, ay, zx, zy] = [p[0]!, p[1]!, p[n - 2]!, p[n - 1]!];
	const m = Math.ceil(Math.hypot(zx - ax, zy - ay) / 3) + 8;
	return bezier(ax, ay, ax + (p[2]! - ax) * k1, ay + (p[3]! - ay) * k1, zx + (p[n - 4]! - zx) * k2, zy + (p[n - 3]! - zy) * k2, zx, zy, m);
}

/** Bend pairs: how far the curve's two control points sit off the straight line, gentlest first; an S costs more than a C. */
const BENDS = [0, 12, -12, 24, -24, 36, -36, 50, -50, 66, -66, 84, -84];
const bendCost = ([p, q]: readonly [number, number]) => Math.max(Math.abs(p), Math.abs(q)) + (p * q < 0 ? 30 : 0) + Math.abs(p - q) * 0.3;
const PAIRS = BENDS.flatMap((p) => BENDS.map((q) => [p, q] as const)).sort((x, y) => bendCost(x) - bendCost(y));
/** The detour grid's cell size in points; a gap too narrow for it is searched again on cells half as big. */
const CELL = 6;
/** A detour search stops after this many steps whatever the picture holds, so no hover can freeze the page; the largest real searches take under half of it. */
const MAX_STEPS = 20_000;
/** How much closer than usual a lit line with no other way may pass a name: it keeps a point of room around the ink. */
const CLOSE = 5;

export function makeRouter(sky: Sky): Router {
	const { clusters, byTopic, starById, width, height } = sky;
	const rects = new Map(clusters.map((k) => [k.topic.id, nameRect(k)]));
	const talls = new Map<string, Rect>();
	const tallOf = (k: Cluster) => talls.get(k.topic.id) ?? talls.set(k.topic.id, nameRect(k, true)).get(k.topic.id)!;

	/** `ends` are the clusters a line belongs to: it leaves them at their edge and may not cut back through. Star chains skip them. */
	const obstaclesFor = (ends: Cluster[], skipEnds: boolean, lead: string | null): Obstacles => ({
		discs: clusters.filter((k) => !(skipEnds && ends.includes(k))).map((k) => ({ x: k.cx, y: k.cy, r: k.r + (ends.includes(k) ? 3 : 6) })),
		boxes: clusters.map((k) => (k.topic.id === lead ? tallOf(k) : rects.get(k.topic.id)!)),
	});
	/** `slack` lets a lit line with no roomier way pass closer to names and clusters, though never on them. */
	const clean = (ob: Obstacles, pts: number[], slack = 0) => {
		const ds = Math.min(3, 2 * slack);
		for (let i = 0; i < pts.length; i += 2) {
			const px = pts[i]!;
			const py = pts[i + 1]!;
			if (px < 2 || py < 2 || px > width - 2 || py > height - 2) return false;
			for (const d of ob.discs) if ((px - d.x) ** 2 + (py - d.y) ** 2 < (d.r - ds) ** 2) return false;
			for (const b of ob.boxes) if (px > b.x0 + slack && px < b.x1 - slack && py > b.y0 && py < b.y1 - slack) return false;
		}
		return true;
	};

	/** How far a point is from the nearest obstacle's edge; below zero inside one. */
	const room = (ob: Obstacles, x: number, y: number) => {
		let least = Math.min(x, y, width - x, height - y);
		for (const d of ob.discs) least = Math.min(least, Math.hypot(x - d.x, y - d.y) - d.r);
		for (const b of ob.boxes) {
			const dx = Math.max(b.x0 - x, x - b.x1);
			const dy = Math.max(b.y0 - y, y - b.y1);
			least = Math.min(least, dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy));
		}
		return least;
	};
	/** A detour's turning points sit on grid cells; each moves up to half a cell to where it has the most room, so a narrow gap is passed in its middle. */
	const centred = (ob: Obstacles, p: number[]) => {
		const out = [...p];
		for (let i = 2; i < p.length - 2; i += 2) {
			let most = -Infinity;
			for (let dx = -3; dx <= 3; dx++)
				for (let dy = -3; dy <= 3; dy++) {
					const r = room(ob, p[i]! + dx, p[i + 1]! + dy);
					if (r > most) [most, out[i], out[i + 1]] = [r, p[i]! + dx, p[i + 1]! + dy];
				}
		}
		return out;
	};

	const cubic = (ob: Obstacles, ax: number, ay: number, ga: number, zx: number, zy: number, gz: number, most: number): number[] | null => {
		const dx = zx - ax;
		const dy = zy - ay;
		const d = Math.hypot(dx, dy);
		const nx = -dy / d;
		const ny = dx / d;
		const lim = Math.min(most, d * 0.34);
		for (const [p, q] of PAIRS) {
			if (Math.abs(p) > lim || Math.abs(q) > lim) continue;
			const pts = bezier(ax, ay, ax + dx / 3 + nx * p, ay + dy / 3 + ny * p, ax + (2 * dx) / 3 + nx * q, ay + (2 * dy) / 3 + ny * q, zx, zy, Math.ceil(d / 3));
			const cut = trimEnds(pts, ax, ay, ga, zx, zy, gz);
			if (cut && clean(ob, cut)) return cut;
		}
		return null;
	};

	// The detour grid: which cells are names or the edge (never crossed) and which belong to a cluster (crossed only by its own lines).
	// A cell is blocked when its centre comes within half a cell of an obstacle, so a line through free cells keeps the obstacles' room.
	const grids = new Map<number, Grid>();
	const gridOf = (G: number, slack: number): Grid => {
		const key = G * 100 + slack;
		const known = grids.get(key);
		if (known) return known;
		const cols = Math.ceil(width / G);
		const rows = Math.ceil(height / G);
		const nameCell = new Uint8Array(cols * rows);
		const discCell = new Int16Array(cols * rows).fill(-1);
		const m = G / 2;
		for (let r = 0; r < rows; r++)
			for (let c = 0; c < cols; c++) {
				const px = (c + 0.5) * G;
				const py = (r + 0.5) * G;
				const i = r * cols + c;
				if (px < 2 + m || py < 2 + m || px > width - 2 - m || py > height - 2 - m) nameCell[i] = 1;
				clusters.forEach((k, ki) => {
					const b = rects.get(k.topic.id)!;
					if (px > b.x0 + slack - m && px < b.x1 - slack + m && py > b.y0 - m && py < b.y1 - slack + m) nameCell[i] = 1;
					if ((px - k.cx) ** 2 + (py - k.cy) ** 2 < (k.r + 6 - Math.min(3, 2 * slack) + m * 1.42) ** 2) discCell[i] = ki;
				});
			}
		const grid = { G, cols, rows, nameCell, discCell };
		grids.set(key, grid);
		return grid;
	};
	const gridPath = (grid: Grid, free: ReadonlySet<number>, tall: Rect | null, hug: number, stretch: number, ax: number, ay: number, zx: number, zy: number): number[] | null => {
		const { G, cols, rows, nameCell, discCell } = grid;
		const blocked = (i: number) => {
			if (nameCell[i] || (discCell[i]! >= 0 && !free.has(discCell[i]!))) return true;
			if (!tall) return false;
			const px = ((i % cols) + 0.5) * G;
			const py = (Math.floor(i / cols) + 0.5) * G;
			return px > tall.x0 - G / 2 && px < tall.x1 + G / 2 && py > tall.y0 - G / 2 && py < tall.y1 + G / 2;
		};
		const cell = (x: number, y: number) => Math.min(rows - 1, Math.max(0, Math.floor(y / G))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / G)));
		const start = cell(ax, ay);
		const goal = cell(zx, zy);
		const gc = goal % cols;
		const gr = Math.floor(goal / cols);
		const h = (i: number) => {
			const dx = Math.abs((i % cols) - gc);
			const dy = Math.abs(Math.floor(i / cols) - gr);
			return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
		};
		const gs = new Float64Array(cols * rows).fill(Infinity);
		const len = new Float64Array(cols * rows);
		const done = new Uint8Array(cols * rows);
		const from = new Int32Array(cols * rows).fill(-1);
		// A binary heap of [estimate, cell].
		const heap: [number, number][] = [];
		const push = (f: number, i: number) => {
			heap.push([f, i]);
			for (let k = heap.length - 1; k > 0; ) {
				const pk = (k - 1) >> 1;
				if (heap[pk]![0] <= heap[k]![0]) break;
				[heap[pk], heap[k]] = [heap[k]!, heap[pk]!];
				k = pk;
			}
		};
		const pop = () => {
			const top = heap[0]!;
			const last = heap.pop()!;
			if (heap.length) {
				heap[0] = last;
				for (let k = 0; ; ) {
					const l = 2 * k + 1;
					let m = k;
					if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
					if (l + 1 < heap.length && heap[l + 1]![0] < heap[m]![0]) m = l + 1;
					if (m === k) break;
					[heap[m], heap[k]] = [heap[k]!, heap[m]!];
					k = m;
				}
			}
			return top[1];
		};
		gs[start] = 0;
		push(h(start), start);
		// A detour much longer than the straight way is not a gentle line, unless no shorter one exists.
		const limit = (Math.hypot(zx - ax, zy - ay) * stretch + 48) / G;
		for (let steps = 0; heap.length && steps < MAX_STEPS; steps++) {
			const i = pop();
			if (i === goal) break;
			// A cell already expanded comes off the heap again only as a stale copy.
			if (done[i]) continue;
			done[i] = 1;
			const c = i % cols;
			const r = Math.floor(i / cols);
			for (let dr = -1; dr <= 1; dr++)
				for (let dc = -1; dc <= 1; dc++) {
					const nc = c + dc;
					const nr = r + dr;
					if ((!dr && !dc) || nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
					const j = nr * cols + nc;
					if (j !== goal && blocked(j)) continue;
					const step = dr && dc ? 1.414 : 1;
					if (len[i]! + step + h(j) > limit) continue;
					// Hugging an obstacle costs extra, so the path keeps to the middle of a gap and rounds softly.
					const near = blocked(j - 1) || blocked(j + 1) || blocked(j - cols) || blocked(j + cols);
					const g = gs[i]! + step + (near ? hug : 0);
					if (g >= gs[j]!) continue;
					gs[j] = g;
					len[j] = len[i]! + step;
					from[j] = i;
					push(g + h(j), j);
				}
		}
		// Below zero or missing (a picture with no size) both mean no way.
		if (!(from[goal]! >= 0)) return null;
		const cells: number[] = [];
		for (let i = goal; i >= 0; i = from[i]!) cells.unshift(i);
		const raw = cells.flatMap((i) => [((i % cols) + 0.5) * G, (Math.floor(i / cols) + 0.5) * G]);
		raw.splice(0, 2, ax, ay);
		raw.splice(raw.length - 2, 2, zx, zy);
		// Pull tight: keep a point only where the straight way past it would hit something.
		const sees = (i: number, j: number) => {
			// Sampled finer than a cell, so a straight cut never clips the corner of a blocked one.
			const d = dense([raw[i]!, raw[i + 1]!, raw[j]!, raw[j + 1]!], G / 4);
			for (let k = 2; k < d.length - 2; k += 2) if (blocked(cell(d[k]!, d[k + 1]!))) return false;
			return true;
		};
		const pulled = [raw[0]!, raw[1]!];
		for (let i = 0; i < raw.length - 2; ) {
			let j = raw.length - 2;
			while (j > i + 2 && !sees(i, j)) j -= 2;
			pulled.push(raw[j]!, raw[j + 1]!);
			i = j;
		}
		return pulled;
	};

	const route = (from: string, to: string, ax: number, ay: number, ga: number, zx: number, zy: number, gz: number, ends: Cluster[], skipEnds: boolean, lead: string | null, lit: boolean): Seg | null => {
		const d = Math.hypot(zx - ax, zy - ay);
		if (d <= ga + gz + 6) return null;
		const ob = obstaclesFor(ends, skipEnds, lead);
		// At rest a line only ever bends a little; a lit line may bend further before it takes a detour.
		const c = cubic(ob, ax, ay, ga, zx, zy, gz, lit ? 84 : Math.min(36, d * 0.18));
		if (c) return seg(from, to, c);
		if (!lit) return null;
		const leadK = lead ? byTopic.get(lead) : null;
		const free = new Set(ends.map((k) => clusters.indexOf(k)));
		const tall = leadK ? tallOf(leadK) : null;
		const ks = [0.6, 0.9, 1.2, 1.6, 2];
		// Of all clean fits to a search's ways through, the one that turns least wins.
		const bestFit = (paths: number[][], slacks: readonly number[]) => {
			// Centring a turn can swing the side next to it closer to something, so the way as found stays a choice too.
			const ways = paths.flatMap((path) => [centred(ob, path), path]);
			const cut = (t: number[]) => trimEnds(t, ax, ay, ga, zx, zy, gz);
			const soft = ways.flatMap((w) => [...ks.flatMap((k1) => ks.map((k2) => handles(w, k1, k2))), smooth(w), rounded(w)]).map(cut);
			const tight = ways.map((w) => cut(filleted(w, 5)));
			const plain = ways.map((w) => cut(dense(w)));
			// Soft curves before tight corners, room before closeness, and last the way with its corners as they are.
			const roomy = slacks.filter((x) => x < CLOSE);
			const close = slacks.filter((x) => x === CLOSE);
			const tries = [
				...[soft, tight].flatMap((fits) => roomy.map((x) => [fits, x] as const)),
				...[soft, tight].flatMap((fits) => close.map((x) => [fits, x] as const)),
				[plain, slacks[slacks.length - 1]!] as const,
			];
			for (const [fits, slack] of tries) {
				let best: number[] | null = null;
				let least = Infinity;
				for (const f of fits) {
					if (!f || !clean(ob, f, slack)) continue;
					const turn = turning(f);
					if (turn < least) [least, best] = [turn, f];
				}
				if (best) return best;
			}
			return null;
		};
		// A lit line is never left out. First two short searches, one hugging less than the other; then, while no fit is found,
		// a longer way, a finer grid for narrow gaps, and last a way close past names.
		const tiers = [
			[CELL, 0, 1.5, [0.6, 1.5]],
			[CELL, 0, 4, [1]],
			[CELL / 2, 0, 4, [1]],
			[CELL / 2, CLOSE, 4, [1]],
		] as const;
		for (const [G, slack, stretch, hugs] of tiers) {
			const paths = hugs.map((hug) => gridPath(gridOf(G, slack), free, tall, hug, stretch, ax, ay, zx, zy)).filter((p): p is number[] => !!p);
			const best = paths.length ? bestFit(paths, slack ? [0, 1.5, CLOSE] : [0, 1.5]) : null;
			if (best) return seg(from, to, best);
		}
		// The score line under the pointed topic's name can wall it in; then the line may pass it, and the score moves to a free spot.
		if (lead) return route(from, to, ax, ay, ga, zx, zy, gz, ends, skipEnds, null, lit);
		// No way through at all, or the search hit its step cap: the plain curve, so a lit neighbour always has its arrow.
		const plain = trimEnds(bezier(ax, ay, ax + (zx - ax) / 3, ay + (zy - ay) / 3, ax + (2 * (zx - ax)) / 3, ay + (2 * (zy - ay)) / 3, zx, zy, Math.ceil(d / 3)), ax, ay, ga, zx, zy, gz);
		return plain && seg(from, to, plain);
	};

	const memo = new Map<string, Seg | null>();
	const remember = (key: string, work: () => Seg | null) => {
		if (!memo.has(key)) memo.set(key, work());
		return memo.get(key)!;
	};
	return {
		link: (from, to, lead, lit) =>
			remember(`t${from}>${to}>${lead}>${lit}`, () => {
				const a = byTopic.get(from);
				const z = byTopic.get(to);
				return a && z ? route(from, to, a.cx, a.cy, a.r + 5, z.cx, z.cy, z.r + 5, [a, z], false, lead, lit) : null;
			}),
		chain: (from, to) =>
			remember(`f${from}>${to}`, () => {
				const a = starById.get(from);
				const z = starById.get(to);
				const ka = a && byTopic.get(a.topicId);
				const kz = z && byTopic.get(z.topicId);
				const g = sky.s / 2 + 4;
				return a && z && ka && kz ? route(from, to, a.cx, a.cy, g, z.cx, z.cy, g, [ka, kz], true, null, true) : null;
			}),
	};
}

/** A chain's line run on to its two stars' centres and cut `gap` short of each, so it meets a star drawn at any size. */
export function toStars(g: Seg, a: Star, z: Star, gap: number): Seg {
	const run = (x0: number, y0: number, x1: number, y1: number) => {
		const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.25));
		return Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]).flat();
	};
	const p = g.pts;
	const n0 = p.length;
	const pts = [...run(a.cx, a.cy, p[0]!, p[1]!), ...p, ...run(p[n0 - 2]!, p[n0 - 1]!, z.cx, z.cy).slice(2), z.cx, z.cy];
	let i = 0;
	while (i < pts.length - 2 && Math.hypot(pts[i]! - a.cx, pts[i + 1]! - a.cy) < gap) i += 2;
	let j = pts.length - 2;
	while (j > i && Math.hypot(pts[j]! - z.cx, pts[j + 1]! - z.cy) < gap) j -= 2;
	const out = pts.slice(i, j + 2);
	const n = out.length;
	let k = n - 4;
	while (k > 0 && Math.hypot(out[n - 2]! - out[k]!, out[n - 1]! - out[k + 1]!) < gap) k -= 2;
	const ex = out[n - 2]! - out[Math.max(0, k)]!;
	const ey = out[n - 1]! - out[Math.max(0, k) + 1]!;
	const e = Math.hypot(ex, ey) || 1;
	return { from: g.from, to: g.to, pts: out, ux: ex / e, uy: ey / e };
}
