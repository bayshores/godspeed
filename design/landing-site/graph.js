// The topic graph: SVG built from data, drawn by scroll progress
// (arrows in "learn this first" order, then rings sweep to their score),
// light pulses running along the arrows, and a hover card per topic.

const NODES = [
	["A", "Derivatives & gradients", 114, 123, 25, 18, 9, 10],
	["B", "Gradient descent step", 292, 90, 24, 16, 8, 9],
	["C", "Convexity", 292, 214, 19, 9, 5, 7],
	["D", "Step size & smoothness", 470, 58, 22, 14, 4, 8, true],
	["E", "Momentum", 639, 91, 18, 7, 0, 0],
	["F", "Adam", 777, 179, 18, 6, 0, 0],
	["G", "Minibatch noise", 470, 288, 21, 11, 3, 7, true],
	["H", "Expectation", 114, 377, 21, 12, 7, 8],
	["I", "Variance", 292, 475, 19, 8, 4, 7],
	["J", "Backprop (chain rule)", 470, 564, 23, 15, 9, 11],
	["K", "Vanishing gradients", 639, 399, 19, 9, 4, 7],
	["L", "Generalization", 777, 454, 20, 10, 0, 0],
	["M", "Regularization", 639, 619, 19, 8, 6, 8],
	["N", "Vectors & matrices", 114, 607, 20, 10, 4, 6],
	["O", "Attention", 777, 731, 19, 9, 7, 8],
].map(([k, name, x, y, r, facts, a, b, over]) => ({ k, name, x, y, r, facts, a, b, over: !!over }));

const EDGES = ["AB", "AC", "BD", "CD", "BG", "DE", "EF", "GE", "GF", "HG", "HI", "IG", "AJ", "JK", "KL", "JM", "ML", "NJ", "NO"];

const RAMP = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981"];
const colorOf = (n) => {
	if (!n.b) return "#5a5a5a";
	const r = n.a / n.b;
	return r < 0.3 ? RAMP[0] : r <= 0.5 ? RAMP[1] : r < 0.7 ? RAMP[2] : r < 0.8 ? RAMP[3] : RAMP[4];
};

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
	const e = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
	if (parent) parent.appendChild(e);
	return e;
};

export function createGraph(svg, card) {
	const byK = Object.fromEntries(NODES.map((n) => [n.k, n]));
	const defs = el("defs", {}, svg);
	const blur = el("filter", { id: "halo", x: "-100%", y: "-100%", width: "300%", height: "300%" }, defs);
	el("feGaussianBlur", { stdDeviation: "7" }, blur);

	const gEdges = el("g", {}, svg);
	const gPulses = el("g", {}, svg);
	const gNodes = el("g", {}, svg);

	// Draw order: by the column (x) of the arrow's source, so arrows build left to right.
	const edges = EDGES.map(([s, t]) => {
		const a = byK[s], b = byK[t];
		const p0 = [a.x + a.r + 4, a.y], p3 = [b.x - b.r - 7, b.y];
		const dx = (p3[0] - p0[0]) * 0.5;
		const d = `M${p0[0]} ${p0[1]}C${p0[0] + dx} ${p0[1]} ${p3[0] - dx} ${p3[1]} ${p3[0]} ${p3[1]}`;
		const path = el("path", { d, class: "edge" }, gEdges);
		const len = path.getTotalLength();
		path.style.strokeDasharray = len;
		path.style.strokeDashoffset = len;
		const head = el("path", { d: `M${p3[0] - 6} ${p3[1] - 4}L${p3[0]} ${p3[1]}L${p3[0] - 6} ${p3[1] + 4}`, class: "head", opacity: 0 }, gEdges);
		// Sample the curve once so the pulses never call getPointAtLength per frame.
		const lut = Array.from({ length: 121 }, (_, i) => { const q = path.getPointAtLength((i / 120) * len); return [q.x, q.y]; });
		return { s, t, path, head, len, lut, order: a.x, color: colorOf(b) };
	}).sort((e1, e2) => e1.order - e2.order);

	let hovered = null;
	const nodes = NODES.map((n) => {
		const c = colorOf(n);
		const g = el("g", { class: "node", transform: `translate(${n.x} ${n.y})` }, gNodes);
		el("circle", { r: n.r + 6, fill: c, class: "halo", filter: "url(#halo)" }, g);
		const inner = el("g", {}, g);
		el("circle", { r: n.r, fill: "#0b0b0b" }, inner);
		el("circle", { r: n.r - 2, fill: "none", stroke: "#262626", "stroke-width": 4 }, inner);
		const circ = 2 * Math.PI * (n.r - 2);
		const arc = el("circle", { r: n.r - 2, fill: "none", stroke: c, "stroke-width": 4, transform: "rotate(-90)", "stroke-dasharray": `0 ${circ}` }, inner);
		el("text", { y: 4.5, "text-anchor": "middle", "font-family": "JetBrains Mono", "font-size": n.r > 21 ? 14 : 12, "font-weight": 600, fill: n.b ? "#e6e6e6" : "#8d8d8d" }, inner).textContent = n.facts;
		const label = el("text", { y: n.r + 22, "text-anchor": "middle", "font-size": 15, "font-weight": 500, fill: n.b ? "#e6e6e6" : "#a0a0a0" }, inner);
		label.textContent = n.name;
		const score = el("text", { y: n.r + 40, "text-anchor": "middle", "font-size": 13, "font-weight": n.over ? 600 : 400, fill: n.b ? c : "#6e6e6e", "font-family": n.b && !n.over ? "JetBrains Mono" : "Source Sans 3" }, inner);
		score.textContent = n.b ? `${n.a}/${n.b}${n.over ? "  ·  overconfident" : ""}` : "Not tested";
		const o = { n, g, inner, arc, circ, color: c };
		g.addEventListener("mouseenter", () => { hovered = o; showCard(n); });
		g.addEventListener("mouseleave", () => { hovered = null; card.classList.remove("on"); });
		return o;
	});

	function showCard(n) {
		const needs = EDGES.filter((e) => e[1] === n.k).map((e) => byK[e[0]].name);
		const leads = EDGES.filter((e) => e[0] === n.k).map((e) => byK[e[1]].name);
		const squares = n.b ? Array.from({ length: n.b }, (_, i) => `<i style="background:${i < n.a ? RAMP[4] : RAMP[0]}"></i>`).join("") : "";
		card.innerHTML = `<h4>${n.name}</h4>
			<div class="hc-bar">${squares}<span>${n.b ? `${n.a}/${n.b} right · ` : "Not tested · "}${n.facts} facts</span></div>
			${n.over ? `<div style="color:${RAMP[1]};font-weight:600">Overconfident</div>` : ""}
			${needs.length ? `<div class="hc-row"><b>Needs</b><span>${needs.join(", ")}</span></div>` : ""}
			${leads.length ? `<div class="hc-row"><b>Leads to</b><span>${leads.join(", ")}</span></div>` : ""}
			<div class="hc-hint">Click for facts and practice</div>`;
		const box = svg.getBoundingClientRect();
		const host = card.parentElement.getBoundingClientRect();
		const s = box.width / 820;
		let x = box.left - host.left + (n.x + n.r + 18) * s;
		const y = box.top - host.top + (n.y - 40) * s;
		if (x + 250 > host.width) x = box.left - host.left + (n.x - n.r - 18) * s - 240;
		card.style.left = `${x}px`;
		card.style.top = `${y}px`;
		card.classList.add("on");
	}

	// Pulses: a short comet of dots per arrow.
	const pulses = edges.map((e, i) => {
		const dots = Array.from({ length: 5 }, (_, k) => el("circle", { r: k === 0 ? 2.6 : 2 - k * 0.3, fill: "#fff", class: "pulse", opacity: 0 }, gPulses));
		const glow = el("circle", { r: 9, fill: "#fff", opacity: 0, filter: "url(#halo)" }, gPulses);
		return { e, dots, glow, off: (i * 0.137) % 1 };
	});

	let drawn = 0;
	// "Minibatch noise" (G) arrives by flying in from the lesson above, so it
	// stays hidden until the flying copy lands.
	let gLanded = false;
	function apply(p) {
		const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
		edges.forEach((e, i) => {
			const a = 0.05 + (i / edges.length) * 0.5;
			const t = ease((p - a) / 0.14);
			e.path.style.strokeDashoffset = e.len * (1 - t);
			e.head.setAttribute("opacity", t > 0.98 ? 1 : 0);
		});
		nodes.forEach((o) => {
			const a = 0.02 + (o.n.x / 820) * 0.55;
			let pop = ease((p - a) / 0.1);
			let sweep = ease((p - a - 0.06) / 0.18);
			if (o.n.k === "G") pop = sweep = gLanded ? 1 : 0;
			o.inner.style.opacity = pop;
			o.inner.style.transform = `scale(${0.6 + 0.4 * pop})`;
			const frac = o.n.b ? o.n.a / o.n.b : 0;
			o.arc.setAttribute("stroke-dasharray", `${o.circ * frac * sweep} ${o.circ}`);
		});
		drawn = p;
		// The topic from the lesson stays lit at the start.
		nodes.find((o) => o.n.k === "G").g.classList.toggle("hot", p < 0.25 && gLanded);
	}

	const at = (e, t) => e.lut[Math.min(120, Math.max(0, Math.round(t * 120)))];
	const halos = nodes.map((o) => o.g.querySelector(".halo"));
	function tick(time) {
		const on = Math.min(Math.max((drawn - 0.6) / 0.2, 0), 1);
		for (const pl of pulses) {
			const t = (time * 0.22 + pl.off) % 1;
			pl.dots.forEach((d, k) => {
				const tk = t - k * 0.022;
				if (tk < 0 || on === 0) return d.setAttribute("opacity", 0);
				const pt = at(pl.e, tk);
				d.setAttribute("cx", pt[0]);
				d.setAttribute("cy", pt[1]);
				d.setAttribute("fill", tk > 0.6 ? pl.e.color === "#5a5a5a" ? "#fff" : pl.e.color : "#fff");
				d.setAttribute("opacity", (1 - k / 5) * on * Math.sin(Math.PI * Math.min(tk * 1.2, 1)));
			});
			const pt = at(pl.e, t);
			pl.glow.setAttribute("cx", pt[0]);
			pl.glow.setAttribute("cy", pt[1]);
			pl.glow.setAttribute("opacity", 0.18 * on * Math.sin(Math.PI * t));
		}
		nodes.forEach((o, i) => {
			halos[i].style.opacity = o.g.classList.contains("hot") || o === hovered ? "" : (0.12 + 0.1 * Math.sin(time * 1.4 + i * 2.1)) * on;
		});
	}

	const gNode = nodes.find((o) => o.n.k === "G");
	function setG(v) {
		if (v === gLanded) return;
		gLanded = v;
		apply(drawn);
	}
	// Where G sits on screen right now: center and ring radius in px.
	function gScreen() {
		const m = svg.getScreenCTM();
		const pt = svg.createSVGPoint();
		pt.x = gNode.n.x;
		pt.y = gNode.n.y;
		const q = pt.matrixTransform(m);
		return { x: q.x, y: q.y, r: gNode.n.r * m.a };
	}

	return { apply, tick, setG, gScreen };
}
