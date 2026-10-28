import { createSky } from "./sky.js";
import { createGraph } from "./graph.js";
import { buildBars, loadShip } from "./ship.js";
import { createFx } from "./fx.js";

const { gsap, ScrollTrigger, Lenis, katex } = window;
gsap.registerPlugin(ScrollTrigger);

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const DESKTOP = innerWidth > 860;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (x, a = 0, b = 1) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ---------- Math ---------- */
for (const e of $$(".tex")) {
	try {
		katex.render(e.dataset.tex, e, { displayMode: !!e.dataset.display, throwOnError: false });
	} catch {}
}

/* ---------- Smooth scroll ---------- */
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
let lenis = null;
let velocity = 0;
let direction = 1;
if (!REDUCED) {
	lenis = new Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
	window.__lenis = lenis;
	lenis.on("scroll", (e) => {
		velocity = e.velocity;
		if (e.direction) direction = e.direction;
		ScrollTrigger.update();
	});
	gsap.ticker.add((t) => lenis.raf(t * 1000));
	gsap.ticker.lagSmoothing(0);
	for (const a of $$('a[href^="#"]')) {
		a.addEventListener("click", (ev) => {
			const target = $(a.getAttribute("href"));
			if (!target) return;
			ev.preventDefault();
			lenis.scrollTo(target, { offset: 0, duration: 1.6 });
		});
	}
}

/* ---------- Split text ---------- */
function split(node) {
	const walk = (n) => {
		if (n.nodeType === 3) {
			const frag = document.createDocumentFragment();
			n.textContent.split(/(\s+)/).forEach((word) => {
				if (!word) return;
				if (/^\s+$/.test(word)) return frag.append(" ");
				const w = document.createElement("span");
				w.className = "w";
				for (const ch of word) {
					const c = document.createElement("span");
					c.className = "ch";
					c.textContent = ch;
					w.append(c);
				}
				frag.append(w);
			});
			n.replaceWith(frag);
		} else if (n.nodeType === 1 && n.tagName !== "BR") [...n.childNodes].forEach(walk);
	};
	[...node.childNodes].forEach(walk);
	return $$(".ch", node);
}

/* ---------- Sky and the comet ---------- */
const sky = createSky($("#sky"));
const mouse = [-1, -1];
addEventListener("mousemove", (e) => { mouse[0] = e.clientX; mouse[1] = e.clientY; });
document.addEventListener("mouseleave", () => { mouse[0] = -1; });

const start = performance.now();
const INTRO = REDUCED ? 0 : 2.4;

// Shooting stars: one quick straight streak each time a new section comes in.
const meteor = { t0: -1e9, a: [0, 0], b: [0, 0] };
let side = 1;
function shootingStar() {
	if (REDUCED || !sky || performance.now() - meteor.t0 < 700) return;
	const W = innerWidth, H = innerHeight;
	side = -side;
	const len = W * (0.4 + Math.random() * 0.2);
	const ang = ((16 + Math.random() * 16) * Math.PI) / 180;
	const x0 = side > 0 ? W * (0.6 + Math.random() * 0.35) : W * (0.05 + Math.random() * 0.35);
	const y0 = H * (0.06 + Math.random() * 0.3);
	meteor.a = [x0, y0];
	meteor.b = [x0 - side * Math.cos(ang) * len, y0 + Math.sin(ang) * len];
	meteor.t0 = performance.now();
}

/* ---------- Hero intro and exit ---------- */
const wordChars = split($("#wordmark"));
if (!REDUCED) {
	gsap.set(wordChars, { yPercent: 115 });
	gsap.set(["#tagline", "#heroCta", ".hero-foot", "#nav"], { opacity: 0, y: 24 });
	const tl = gsap.timeline({ delay: 0.5 });
	tl.to(wordChars, { yPercent: 0, duration: 1.1, ease: "expo.out", stagger: 0.06 })
		.to("#tagline", { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, "-=0.6")
		.to("#heroCta", { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, "-=0.7")
		.to([".hero-foot", "#nav"], { opacity: 1, y: 0, duration: 0.9, ease: "power3.out" }, "-=0.6");

	gsap.timeline({ scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: 0.4 } })
		.fromTo("#wordmark", { scale: 1, yPercent: 0, filter: "blur(0px)", opacity: 1 }, { scale: 1.45, yPercent: -30, filter: "blur(14px)", opacity: 0, ease: "none", immediateRender: false }, 0)
		// fromTo with explicit starts: a refresh mid-intro must not snap things
		// back to their pre-intro state. Letters exit on "y" so they never fight
		// the intro's "yPercent".
		.fromTo(wordChars, { y: 0 }, { y: (i, c) => -(0.2 + (i % 3) * 0.25) * c.offsetHeight, ease: "none", immediateRender: false }, 0)
		.fromTo(["#tagline", "#heroCta"], { y: 0, opacity: 1 }, { y: -80, opacity: 0, ease: "none", immediateRender: false }, 0)
		.fromTo(".hero-foot", { opacity: 1 }, { opacity: 0, ease: "none", immediateRender: false }, 0);
}

/* ---------- Reveals ---------- */
function splitReveal(el) {
	const chars = split(el);
	if (REDUCED) return;
	gsap.from(chars, {
		yPercent: 115,
		rotate: 6,
		opacity: 0,
		duration: 1,
		ease: "expo.out",
		stagger: 0.022,
		scrollTrigger: { trigger: el, start: "top 85%", toggleActions: "play none none reverse" },
	});
}
$$(".split").forEach(splitReveal);
if (!REDUCED) {
	for (const el of $$(".reveal")) {
		gsap.from(el, { y: 50, opacity: 0, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none reverse" } });
	}
}

/* ---------- Shader effects ---------- */
const fx = createFx();
if (fx) {
	// Chrome letters need the real font loaded, or the glyphs won't line up.
	document.fonts.load('700 100px "CMU Serif"').then(() => {
		fx.chrome($("#wordmark"), { bevel: 9, gsap });
	});
	$$(".fx-strip").forEach((c) => fx.strip(c, +c.dataset.pos, +c.dataset.phase));
	$$(".shimmer").forEach((b) => fx.shimmer(b, !b.classList.contains("btn-primary")));
}
const forget = fx ? fx.forget($("#forget")) : null;
const forkLight = fx ? fx.fork($("#forkLight")) : null;

/* ---------- The problem: the chat plays like a real one ---------- */
// Once the window is on screen it plays at reading speed (and pauses while
// it's off screen): the oct 12 chat, then it crumbles while the date counts up
// to oct 22, then a fresh chat with no memory of the first. Then "replay".
const chat = (() => {
	const cItems = $$("#chatOld .c-item"), typing = $("#typing");
	const nItems = $$("#chatNew .n-item");
	const same = $(".same"), dayChip = $("#dayChip"), dayGap = $("#dayGap");
	const classOld = $("#classOld"), classNew = $("#classNew"), replay = $("#replay");
	// When each piece shows up, in seconds.
	const OLD = [0.4, 3.0, 5.8];
	const DOTS = [1.3, 3.0];
	const NEW = [10.2, 10.9, 11.8, 13.0];
	const END = 14.2;
	const shown = new Map();
	function show(el, on, instant) {
		if (shown.get(el) === on) return;
		shown.set(el, on);
		el.style.display = on ? "" : "none";
		if (on && !instant && !REDUCED) gsap.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" });
		else gsap.set(el, { opacity: 1, y: 0 });
	}
	const st = { t: 0, playing: false, visible: false };
	function apply(t, instant) {
		cItems.forEach((it, k) => show(it, t >= OLD[k], instant));
		show(typing, t >= DOTS[0] && t < DOTS[1], instant);
		if (forget) forget.u.u_amount = seg(t, 7.8, 9.8);
		else $("#chatOld").style.opacity = 1 - seg(t, 7.8, 9.4);
		const day = 12 + Math.round(seg(t, 8.0, 9.8) * 10);
		dayChip.textContent = `oct ${day}`;
		dayGap.textContent = `+${day - 12} day${day - 12 === 1 ? "" : "s"}`;
		dayGap.style.opacity = seg(t, 8.0, 8.3);
		const swap = t >= 8.9;
		classOld.style.opacity = swap ? 0 : 1;
		classNew.style.opacity = swap ? 1 : 0;
		nItems.forEach((it, k) => show(it, t >= NEW[k], instant));
		same.classList.toggle("hit", t >= NEW[3] + 0.6);
		replay.classList.toggle("on", t >= END);
	}
	replay.addEventListener("click", () => { st.t = 0; apply(0, true); st.playing = true; });
	new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; }, { threshold: 0.35 }).observe($("#cwin"));
	if (REDUCED) apply(END, true);
	else {
		apply(0, true);
		ScrollTrigger.create({ trigger: "#cwin", start: "top 70%", once: true, onEnter: () => { st.playing = true; } });
	}
	return {
		tick(dt) {
			if (!st.playing || !st.visible) return;
			st.t += dt;
			apply(st.t);
			if (st.t >= END) st.playing = false;
		},
	};
})();

/* ---------- About: the fork, drawn by a comet of light ---------- */
// The comet in the shader reaches path position t at scroll p = t / 1.25, so
// each commit pops right as the light passes it.
const forkPath = $("#forkPath");
const forkLen = forkPath.getTotalLength();
forkPath.style.strokeDasharray = forkLen;
const ups = $$("#fork .uc").map((c) => ({ c, at: (((+c.getAttribute("cx") - 40) / 660) * 0.45) / 1.25 }));
const gcs = $$("#fork .gc").map((c) => ({ c, at: (0.7 + ((+c.getAttribute("cx") - 860) / 310) * 0.3) / 1.25 }));
const forkTag = $("#forkTag"), forkPoint = $("#fork .fp");
function applyFork(p) {
	for (const { c, at } of [...ups, ...gcs]) {
		const t = ease(seg(p, at - 0.01, at + 0.04));
		c.style.transform = `scale(${t})`;
	}
	forkPoint.style.transform = `scale(${ease(seg(p, 0.35, 0.39))})`;
	forkPath.style.strokeDashoffset = forkLen * (1 - seg(p, 0.36, 0.8));
	const tg = ease(seg(p, 0.8, 0.88));
	forkTag.style.opacity = tg;
	forkTag.style.transform = `translateY(${(1 - tg) * -18}px)`;
	if (forkLight) forkLight.u.u_p = p;
}
applyFork(REDUCED ? 1 : 0);

/* ---------- Ticker ---------- */
const TOPICS = [["Derivatives & gradients", 9, 10], ["Minibatch noise", 3, 7], ["Backprop (chain rule)", 9, 11], ["Step size & smoothness", 4, 8], ["Expectation", 7, 8], ["Momentum", 0, 0], ["Convexity", 5, 7], ["Vanishing gradients", 4, 7], ["Attention", 7, 8], ["Variance", 4, 7]];
const FACTS = [["Minibatch gradient is unbiased", 0], ["Noise variance shrinks like 1/B", 0], ["Bigger batches cost more per step", 4], ["Noise can help escape flat regions", -1], ["Each example has probability 1/N", 4], ["Variance shrinks as the batch grows", 2]];
const RAMP = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981"];
const rcol = (a, b) => (!b ? "#5a5a5a" : RAMP[a / b < 0.3 ? 0 : a / b <= 0.5 ? 1 : a / b < 0.7 ? 2 : a / b < 0.8 ? 3 : 4]);
const ringSvg = (a, b, c) => {
	const C = 2 * Math.PI * 12;
	return `<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="12" fill="none" stroke="#262626" stroke-width="3.5"/><circle cx="15" cy="15" r="12" fill="none" stroke="${c}" stroke-width="3.5" stroke-dasharray="${b ? (C * a) / b : 0} ${C}" transform="rotate(-90 15 15)"/></svg>`;
};
const topicSet = TOPICS.map(([n, a, b]) => { const c = rcol(a, b); return `<span class="tk">${ringSvg(a, b, c)}${n}<em style="color:${c}">${b ? `${a}/${b}` : "not tested"}</em></span>`; }).join("");
const factSet = FACTS.map(([n, s]) => `<span class="tf"><i style="${s < 0 ? "border:1.5px solid #8d8d8d" : `background:${RAMP[s]}`}"></i>${n}</span>`).join("");
const rows = [
	{ el: $("#tickTopics"), html: topicSet, speed: 70, sign: 1, x: 0 },
	{ el: $("#tickFacts"), html: factSet, speed: 45, sign: -1, x: 0 },
];
for (const r of rows) r.el.innerHTML = `<div class="set">${r.html}</div><div class="set">${r.html}</div><div class="set">${r.html}</div>`;
// Measure the repeat width once (and again on resize / font load), never per frame.
const measureTicker = () => { for (const r of rows) r.w = r.el.firstElementChild.offsetWidth || 1; };
measureTicker();
document.fonts?.ready.then(measureTicker);
let skew = 0;

/* ---------- How it works: terminal, then one lesson, on a loop ---------- */
// While the stage is on screen it plays by itself: the terminal types the
// commands, the godspeed window opens over it and runs measure → plan →
// teach → practice, and at "Right" the topic pops out as a graph node.
// The tabs follow along and can be clicked to jump to a step.
const lines = $$("#term .tl").map((l) => ({ el: $("span", l), text: l.dataset.text }));
const caret = $("#caret");
Object.assign(caret.style, { position: "static", display: "inline-block", verticalAlign: "-3px", marginLeft: "2px" });
const totalChars = lines.slice(0, 3).reduce((s, l) => s + l.text.length, 0);
function applyTerminal(t) {
	let n = Math.floor(seg(t, 0.2, 2.4) * totalChars);
	let caretAt = lines[0].el;
	lines.forEach((l, i) => {
		if (i === 3) { l.el.textContent = t >= 2.6 ? l.text : ""; if (t >= 2.6) caretAt = l.el; return; }
		const k = clamp(n, 0, l.text.length);
		l.el.textContent = l.text.slice(0, k);
		if (n > 0) caretAt = l.el;
		n -= l.text.length;
	});
	caretAt.after(caret);
}

const wrap = $("#windowWrap"), win = $("#window"), stage = $("#stage");
const stepsEls = $$("#steps li"), tabDesc = $("#tabDesc");
const tItems = $$(".t-item"), rItems = $$(".r-item");
const opt3 = $("#opt3"), bars = $$("#confBars i"), think = $("#think"), submit = $("#submit"), badge = $("#badge");
const cursor = $("#cursor"), stepbar = $("#stepbar"), collapseNode = $("#collapseNode");
stepbar.innerHTML = Array.from({ length: 14 }, () => "<i></i>").join("");
const stepIs = $$("i", stepbar);
const offsetIn = (node, root) => {
	let x = 0, y = 0;
	while (node && node !== root) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
	return [x, y];
};
let pts = {};
function sizeWindow() {
	const narrow = innerWidth <= 860;
	const left = narrow ? 16 : 64, top = narrow ? 64 : 96;
	const sc = Math.min((stage.clientWidth - left) / 1280, 1);
	wrap.style.width = `${1280 * sc}px`;
	wrap.style.height = `${800 * sc}px`;
	win.style.transform = `scale(${sc})`;
	win.style.transformOrigin = "0 0";
	stage.style.height = `${top + 800 * sc + 40}px`;
	const main = $(".w-main");
	const at = (n, fx, fy) => { const [x, y] = offsetIn(n, main); return [x + n.offsetWidth * fx, y + n.offsetHeight * fy]; };
	pts = { start: [420, 420], opt: at(opt3, 0.3, 0.5), conf: at(bars[3], 0.5, 0.5), submit: at(submit, 0.12, 0.5) };
}
sizeWindow();
const CONF_H = [22, 38, 56, 76, 96];
function moveCursor(a, b, t) {
	const e = easeIO(clamp(t));
	cursor.style.transform = `translate(${lerp(a[0], b[0], e)}px, ${lerp(a[1], b[1], e)}px)`;
}
// What happens inside the lesson window, for p from 0.09 (measure starts)
// to 0.88 (practice done).
function applyLesson(p) {
	tItems.forEach((it, k) => {
		const t = ease(seg(p, 0.09 + k * 0.012, 0.13 + k * 0.012));
		it.style.opacity = t;
		it.style.transform = `translateY(${(1 - t) * 16}px)`;
	});
	cursor.style.opacity = p > 0.16 && p < 0.79 ? 1 : 0;
	if (p < 0.24) moveCursor(pts.start, pts.opt, seg(p, 0.16, 0.22));
	else if (p < 0.72) moveCursor(pts.opt, pts.conf, seg(p, 0.24, 0.28));
	if (p >= 0.72) moveCursor(pts.conf, pts.submit, seg(p, 0.72, 0.75));
	opt3.classList.toggle("pick", p >= 0.22);
	const level = p < 0.26 ? 0 : Math.min(4, 1 + Math.floor(seg(p, 0.26, 0.3) * 4));
	bars.forEach((b, i) => {
		b.style.height = `${CONF_H[i]}%`;
		b.style.background = i < level ? (i === level - 1 ? "#84cc16" : "#84cc1666") : "#262626";
	});
	const lab = $("#confLabel");
	lab.textContent = level === 4 ? "4 · Fairly sure" : level ? `${level}` : "How sure are you?";
	lab.style.color = level === 4 ? "#84cc16" : "";
	const tt = think.dataset.text;
	think.textContent = tt.slice(0, Math.floor(seg(p, 0.3, 0.36) * tt.length));
	const done = Math.round(seg(p, 0.36, 0.48) * 10);
	stepIs.forEach((s, i) => { s.className = i < done ? "done" : i === done && p >= 0.36 ? "cur" : ""; });
	$("#stepCount").textContent = `${p >= 0.36 ? done + 1 : 0} / 14`;
	rItems.forEach((it, k) => {
		const t = ease(seg(p, 0.5 + k * 0.035, 0.55 + k * 0.035));
		it.style.opacity = t;
		it.style.transform = `translateY(${(1 - t) * 20}px)`;
		it.style.filter = `blur(${(1 - t) * 6}px)`;
	});
	submit.classList.toggle("go", p >= 0.75);
	const b = ease(seg(p, 0.77, 0.82));
	badge.style.opacity = b;
	badge.style.transform = `scale(${0.9 + 0.1 * b})`;
}

// The loop, in seconds. Each step maps onto its slice of the lesson.
const STEPS = [
	{ t0: 3.6, t1: 8.0, p0: 0.09, p1: 0.36 },
	{ t0: 8.0, t1: 10.8, p0: 0.36, p1: 0.5 },
	{ t0: 10.8, t1: 15.0, p0: 0.5, p1: 0.74 },
	{ t0: 15.0, t1: 18.0, p0: 0.74, p1: 0.88 },
];
const LOOP = 21.5, POP = 16.6;
let activeStep = -1;
function applyDemo(t) {
	applyTerminal(t);
	const fade = 1 - seg(t, 20.5, 21);
	const open = ease(seg(t, 3.0, 3.6)) * fade;
	wrap.style.opacity = open;
	wrap.style.transform = `translateY(${(1 - open) * 30}px) scale(${0.96 + 0.04 * open})`;
	let p = 0;
	for (const s of STEPS) if (t >= s.t0) p = lerp(s.p0, s.p1, seg(t, s.t0, s.t1));
	applyLesson(p);
	let cur = 0;
	STEPS.forEach((s, i) => {
		if (t >= s.t0) cur = i;
		stepsEls[i].style.setProperty("--p", t >= s.t1 ? 1 : seg(t, s.t0, s.t1));
		stepsEls[i].style.setProperty("--fill", stepsEls[i].dataset.c);
	});
	if (cur !== activeStep) {
		activeStep = cur;
		stepsEls.forEach((li, i) => li.classList.toggle("on", i === cur));
		tabDesc.textContent = stepsEls[cur].dataset.desc;
	}
	const pop = ease(seg(t, POP, POP + 0.4)) * fade;
	collapseNode.style.opacity = pop;
	collapseNode.style.transform = `scale(${0.5 + 0.5 * pop})`;
}
const demo = { t: 0, visible: false };
stepsEls.forEach((li, i) => $("button", li).addEventListener("click", () => { demo.t = STEPS[i].t0 + 0.01; applyDemo(demo.t); }));
new IntersectionObserver(([e]) => { demo.visible = e.isIntersecting; }, { threshold: 0.25 }).observe(stage);
applyDemo(REDUCED ? 18 : 0);
function tickDemo(dt) {
	if (REDUCED || !demo.visible) return;
	demo.t = (demo.t + dt) % LOOP;
	applyDemo(demo.t);
}

/* ---------- Graph: draws itself once it's on screen ---------- */
const graph = createGraph($("#graphSvg"), $("#hoverCard"));
let graphOnScreen = false;
new IntersectionObserver(([e]) => { graphOnScreen = e.isIntersecting; }).observe($("#graph"));
let finP = 0;
const drawG = { p: 0, on: false };
if (REDUCED) { graph.setG(true); graph.apply(1); }
else {
	graph.apply(0);
	ScrollTrigger.create({ trigger: ".graph-box", start: "top 70%", once: true, onEnter: () => { drawG.on = true; } });
}
function tickGraph(dt) {
	if (!drawG.on || drawG.p >= 1) return;
	drawG.p = Math.min(1, drawG.p + dt / 3.2);
	graph.apply(drawG.p);
}

/* ---------- How it works → graph: the node flies into place ---------- */
// As you scroll from the demo down to the graph, a copy of the "Minibatch
// noise" node leaves the lesson window, arcs across and lands as that topic.
const flyer = collapseNode.cloneNode(true);
flyer.removeAttribute("id");
flyer.classList.add("flyer");
flyer.setAttribute("aria-hidden", "true");
document.body.append(flyer);
const flyerLabel = $("span", flyer);
let flyState = -1;
function flyNode(y) {
	if (REDUCED) return;
	const top = $("#graph").getBoundingClientRect().top + y;
	const a = top - innerHeight * 0.9, b = top - innerHeight * 0.05;
	const f = clamp((y - a) / Math.max(b - a, 1));
	const state = f <= 0 ? 0 : f >= 1 ? 2 : 1;
	if (state !== flyState) {
		flyState = state;
		collapseNode.style.visibility = state === 0 ? "" : "hidden";
		flyer.style.opacity = state === 1 ? 1 : 0;
		graph.setG(state === 2);
	}
	if (state !== 1) return;
	const ring = $("svg", collapseNode).getBoundingClientRect();
	// Start from the node at its full size, even if it hasn't popped out yet.
	const from = { x: ring.left + ring.width / 2, y: ring.top + ring.height / 2, r: 25.6 };
	const to = graph.gScreen();
	const e = easeIO(f);
	const bow = Math.sin(Math.PI * e);
	const x = lerp(from.x, to.x, e) - bow * innerWidth * 0.08;
	const yy = lerp(from.y, to.y, e) - bow * 40;
	// The flyer's ring is 25.6px at scale 1 (r 24 in a 60 box drawn at 64px).
	const s = lerp(from.r, to.r, e) / 25.6 * (1 + bow * 0.2);
	flyer.style.transform = `translate(${x - flyer.offsetWidth / 2}px, ${yy - 32}px) scale(${s})`;
	flyer.style.filter = `drop-shadow(0 0 ${18 + bow * 34}px #f97316${bow > 0.5 ? "cc" : "88"})`;
	flyerLabel.style.opacity = 1 - seg(f, 0.25, 0.5);
}

/* ---------- Classes: screenshot crops ---------- */
for (const c of $$(".crop")) {
	const [x0, x1, y0, y1] = c.dataset.box.split(",").map(Number);
	c.style.aspectRatio = `${x1 - x0} / ${y1 - y0}`;
	const img = document.createElement("img");
	img.src = c.dataset.src;
	img.alt = "";
	img.loading = "lazy";
	img.decoding = "async";
	Object.assign(img.style, { width: `${(1440 / (x1 - x0)) * 100}%`, left: `${(-x0 / (x1 - x0)) * 100}%`, top: `${(-y0 / (y1 - y0)) * 100}%` });
	c.append(img);
}

/* ---------- Ship log ---------- */
buildBars();
loadShip().then(() => ScrollTrigger.refresh());
if (!REDUCED) {
	ScrollTrigger.create({
		trigger: ".ship-row",
		start: "top 75%",
		once: true,
		onEnter: () => {
			for (const col of $$("#version .col")) {
				const n = col.children.length;
				gsap.fromTo(col, { y: 0 }, { y: () => `-${(n - 1) * 0.95}em`, duration: 1.6 + Math.random() * 0.6, ease: "expo.out" });
			}
			gsap.from("#commits li", { x: 60, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.07 });
			gsap.from("#assets li", { y: 20, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.06, delay: 0.3 });
		},
	});
	gsap.from("#bars i", { scaleY: 0, duration: 1, ease: "expo.out", stagger: 0.012, scrollTrigger: { trigger: ".chart", start: "top 85%", toggleActions: "play none none reverse" } });
} else {
	for (const col of $$("#version .col")) col.style.transform = `translateY(-${(col.children.length - 1) * 0.95}em)`;
}
// The version may be re-rendered by live data: snap any finished roll to the new last digit.
new MutationObserver(() => {
	for (const col of $$("#version .col")) col.style.transform = `translateY(-${(col.children.length - 1) * 0.95}em)`;
}).observe($("#version"), { childList: true });

/* ---------- Magnetic buttons and nav ---------- */
if (!REDUCED && matchMedia("(pointer: fine)").matches) {
	for (const b of $$(".magnetic")) {
		b.addEventListener("mousemove", (e) => {
			const r = b.getBoundingClientRect();
			gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.4, ease: "power3.out" });
		});
		b.addEventListener("mouseleave", () => gsap.to(b, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.4)" }));
	}
}
let lastY = 0;
const nav = $("#nav");
// Underline the nav link for the section you're in (the ship log counts as about).
const navFor = { problem: "problem", how: "how", graph: "graph", classes: "classes", about: "about", ship: "about" };
const navLinks = $$("#navLinks a[data-sec]");
const navWatch = new IntersectionObserver((entries) => {
	for (const e of entries) {
		if (!e.isIntersecting) continue;
		const sec = navFor[e.target.id];
		navLinks.forEach((a) => a.classList.toggle("on", !!sec && a.dataset.sec === sec));
	}
}, { rootMargin: "-45% 0px -50% 0px" });
$$("main > section").forEach((el) => navWatch.observe(el));

/* ---------- Frame loop ---------- */
let prev = performance.now();
gsap.ticker.add(() => {
	const now = performance.now();
	const dt = Math.min((now - prev) / 1000, 0.05);
	prev = now;
	const t = (now - start) / 1000;
	const y = lenis ? lenis.scroll : scrollY;
	const vh = innerHeight;

	// Nav hides going down, shows going up.
	if (Math.abs(y - lastY) > 4) {
		nav.classList.toggle("hidden", y > lastY && y > 200);
		nav.classList.toggle("solid", y > 40);
		lastY = y;
	}

	// Ticker: faster with scroll speed, reverses when scrolling up.
	const v = REDUCED ? 0 : velocity;
	skew = lerp(skew, clamp(v * 0.35, -10, 10), 0.12);
	for (const r of rows) {
		const setW = r.w;
		r.x -= (r.speed + Math.abs(v) * 28) * r.sign * direction * dt * (REDUCED ? 0 : 1);
		r.x = ((r.x % setW) - setW) % setW;
		r.el.style.transform = `translateX(${r.x}px) skewX(${r.sign > 0 ? -skew : 0}deg)`;
	}

	if (graphOnScreen) graph.tick(t);
	chat.tick(dt);
	tickDemo(dt);
	tickGraph(dt);
	if (fx) fx.tick(REDUCED ? 0 : t, mouse);
	flyNode(y);
	velocity *= 0.92;
	if (!sky) return;

	// The big comet lives only in the hero (flies in, then drifts up with the
	// sky) and in the ending (enters from the right). Its tail is always straight.
	const heroOut = clamp(y / (vh * 0.9));
	const hero = finP <= 0;
	const diag = Math.hypot(innerWidth, vh);
	let head, tailEnd, cometVis, shift;
	if (hero) {
		const from = sky.heroPoint("tail"), to = sky.heroPoint("head");
		const e = 1 - Math.pow(1 - clamp(t / Math.max(INTRO, 0.001)), 3);
		shift = -y * 0.45;
		head = [lerp(from[0], to[0], e), lerp(from[1], to[1], e) + shift];
		tailEnd = [from[0], from[1] + shift];
		cometVis = 1 - heroOut;
	} else {
		const from = sky.heroPoint("tail", true), to = sky.heroPoint("head", true);
		const e = 1 - Math.pow(1 - clamp(finP / 0.8), 3);
		shift = (1 - finP) * 160;
		head = [lerp(from[0], to[0], e), lerp(from[1], to[1], e) + shift];
		tailEnd = [from[0], from[1] + shift];
		cometVis = clamp(finP * 6);
	}
	const flown = Math.hypot(head[0] - tailEnd[0], head[1] - tailEnd[1]);
	const maxLen = diag * 0.62;
	if (flown > maxLen) {
		tailEnd = [head[0] + ((tailEnd[0] - head[0]) / flown) * maxLen, head[1] + ((tailEnd[1] - head[1]) / flown) * maxLen];
	}
	const sc = Math.max(innerWidth / 1440, vh / 960);

	sky.draw({
		time: t,
		mouse,
		head,
		tailEnd,
		headR: 15 * Math.min(sc, 1.2),
		cometVis,
		met0: meteor.a,
		met1: meteor.b,
		metP: (now - meteor.t0) / 950,
		conVis: hero ? 1 - heroOut : finP,
		conMirror: hero ? 0 : 1,
		conGreen: hero ? 0 : 1,
		conT: hero ? (REDUCED ? 99 : t) : finP * 3.4,
		conShift: hero ? shift : (1 - finP) * 160,
		starShift: y * 0.22,
	});
});

/* ---------- Triggers that must come after every pin ---------- */
if (!REDUCED) ScrollTrigger.create({ trigger: "#fork", start: "top 85%", end: "bottom 40%", scrub: 0.6, onUpdate: (st) => applyFork(st.progress) });
ScrollTrigger.create({ trigger: "#download", start: "top bottom", end: "top top", onUpdate: (st) => { finP = st.progress; }, onLeaveBack: () => { finP = 0; } });
for (const el of $$("main > section")) {
	if (el.id === "hero" || el.id === "download") continue;
	ScrollTrigger.create({ trigger: el, start: "top 65%", onEnter: shootingStar, onEnterBack: shootingStar });
}

addEventListener("resize", () => { sizeWindow(); measureTicker(); fx?.layout(); ScrollTrigger.refresh(); });
document.fonts?.ready.then(sizeWindow);
window.addEventListener("load", () => ScrollTrigger.refresh());
