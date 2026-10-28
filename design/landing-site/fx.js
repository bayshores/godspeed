// Small shader effects on top of the page. They all share ONE hidden WebGL
// canvas (browsers only allow a handful per page): each effect renders into
// it, then the result is copied onto that effect's own 2D canvas. Effects only
// draw while they are on screen.
//
//   chrome   the hero "godspeed" wordmark as polished metal
//   forget   the old chat panel dissolving (an overlay, since a web page
//            can't hand its own pixels to a shader)
//   strip    the red-to-green bars with light flowing along them
//   fork     a comet of light running down the fork diagram
//   shimmer  a light sweep across download buttons on hover
//
// The same shaders, written for pen.dev, live in design/landing/shaders/.

const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}`;

const SHADERS = {
	// Height comes from a blurred copy of the letters, the normal from its
	// slope, the color from a studio reflection plus a light at the mouse.
	chrome: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_k;
uniform sampler2D u_content; uniform sampler2D u_height;
void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	float a = texture2D(u_content, uv).a;
	if (a < 0.002) { gl_FragColor = vec4(0.0); return; }
	vec2 e = vec2(1.5) / u_res;
	float dx = texture2D(u_height, uv + vec2(e.x, 0.0)).a - texture2D(u_height, uv - vec2(e.x, 0.0)).a;
	float dy = texture2D(u_height, uv + vec2(0.0, e.y)).a - texture2D(u_height, uv - vec2(0.0, e.y)).a;
	vec3 n = normalize(vec3(-dx * u_k, -dy * u_k, 1.0));
	vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
	float y = uv.y + r.y * 0.55 + 0.04 * sin(u_time * 0.35);
	vec3 env = mix(vec3(0.06), vec3(0.42, 0.44, 0.48), smoothstep(0.05, 0.42, y));
	env += vec3(1.0) * exp(-pow((y - 0.52) * 7.0, 2.0)) * 0.9;
	env = mix(env, vec3(0.78, 0.8, 0.86), smoothstep(0.6, 1.0, y));
	float g = fract(sin(floor(gl_FragCoord.y) * 91.7) * 4375.5);
	env *= 0.94 + 0.06 * g;
	vec2 m = u_mouse / u_res;
	vec3 l = normalize(vec3((m - uv) * vec2(u_res.x / u_res.y, 1.0) * 1.6, 0.7));
	float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
	float band = fract(uv.x * 0.5 - uv.y * 0.15 - u_time * 0.06);
	float sweep = exp(-pow((band - 0.5) * 14.0, 2.0)) * 0.45;
	vec3 c = env + spec * 0.9 + sweep;
	gl_FragColor = vec4(clamp(c, 0.0, 1.0) * a, a);
}`,

	// The window background where the chat has been "forgotten", a faint glow at the edge.
	// Top of the panel (the oldest lines) goes first.
	forget: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_amount;
${NOISE}
void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec2 cell = floor(gl_FragCoord.xy / 3.0);
	float n = noise(gl_FragCoord.xy / 90.0) * 0.7 + noise(gl_FragCoord.xy / 22.0) * 0.25 + hash(cell) * 0.05;
	float t = n * 0.4 + (1.0 - uv.y) * 0.6;
	float cut = u_amount * 1.25 - 0.1;
	float keep = smoothstep(cut - 0.035, cut + 0.035, t);
	float edge = exp(-pow((t - cut) * 70.0, 2.0)) * step(0.001, u_amount);
	float sparkle = step(0.995, hash(cell + floor(u_time * 4.0)));
	float fade = 0.35 * smoothstep(0.0, 0.6, u_amount);
	float a = max(1.0 - keep, fade);
	vec3 glow = vec3(0.55, 0.6, 0.7) * edge * (0.16 + sparkle * 0.8);
	// Fill with the window's own background (#0a0a0a) so text melts into it.
	gl_FragColor = vec4(vec3(0.039) * a + glow, a);
}`,

	strip: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_pos; uniform float u_phase;
vec3 ramp(float t) {
	vec3 a = vec3(0.937, 0.267, 0.267), b = vec3(0.976, 0.451, 0.086), c = vec3(0.918, 0.702, 0.031), d = vec3(0.518, 0.8, 0.086), e = vec3(0.063, 0.725, 0.506);
	t = clamp(t, 0.0, 1.0) * 4.0;
	return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : t < 3.0 ? mix(c, d, t - 2.0) : mix(d, e, t - 3.0);
}
void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec3 c = ramp(u_pos + uv.x * 0.25);
	float p = fract(u_time * 0.18 + u_phase) * 1.3 - 0.15;
	float d = uv.x - p;
	float pulse = exp(-d * d * 60.0) + exp(min(d, 0.0) * 9.0) * step(d, 0.0) * 0.25;
	gl_FragColor = vec4(c * (0.55 + pulse * 0.9) + vec3(1.0) * pulse * 0.35, 1.0);
}`,

	// Coordinates follow the 1248x200 fork diagram (y down).
	fork: `precision highp float;
uniform vec2 u_res; uniform float u_p;
vec2 path(float t) {
	if (t < 0.45) return vec2(mix(40.0, 700.0, t / 0.45), 50.0);
	if (t < 0.7) {
		float s = (t - 0.45) / 0.25, u = 1.0 - s;
		return u*u*u*vec2(700.0, 50.0) + 3.0*u*u*s*vec2(780.0, 50.0) + 3.0*u*s*s*vec2(760.0, 140.0) + s*s*s*vec2(860.0, 140.0);
	}
	return vec2(mix(860.0, 1170.0, (t - 0.7) / 0.3), 140.0);
}
void main() {
	vec2 q = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res * vec2(1248.0, 200.0);
	float p = u_p * 1.25;
	float glow = 0.0;
	for (int i = 0; i < 18; i++) {
		float t = p - float(i) * 0.012;
		if (t < 0.0 || t > 1.0) continue;
		float d = length(q - path(t));
		float k = 1.0 - float(i) / 18.0;
		glow += k * (exp(-d * d / 6.0) * 0.9 + exp(-d * d / 160.0) * 0.18);
	}
	float land = smoothstep(1.0, 1.04, p);
	vec2 tq = (q - vec2(1198.0, 140.0)) / vec2(48.0, 18.0);
	float tag = exp(-dot(tq, tq) * 0.5) * land * (0.55 + 0.1 * sin(p * 40.0));
	float a = clamp(glow + tag * 0.5, 0.0, 1.0);
	gl_FragColor = vec4(vec3(a), a);
}`,

	// u_light 1 = a bright sweep with star glints (dark buttons),
	// 0 = a cool metal sheen (white buttons).
	shimmer: `precision highp float;
uniform vec2 u_res; uniform float u_time; uniform float u_on; uniform float u_light;
${NOISE}
void main() {
	vec2 f = gl_FragCoord.xy;
	float band = fract((f.x - f.y * 0.6) / (u_res.x * 2.2) - u_time * 0.35 + 0.3);
	float sweep = exp(-pow((band - 0.5) * 18.0, 2.0)) * u_on;
	float star = step(0.992, hash(floor(f / 3.0))) * sweep;
	vec4 lightC = vec4(vec3(sweep * 0.16 + star * 0.9), sweep * 0.16 + star * 0.9);
	vec4 sheen = vec4(vec3(0.62, 0.68, 0.8) * sweep * 0.35, sweep * 0.35);
	gl_FragColor = mix(sheen, lightC, u_light);
}`,
};

export function createFx() {
	const glc = document.createElement("canvas");
	const gl = glc.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
	if (!gl) return null;
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	gl.enable(gl.SCISSOR_TEST);

	const progs = {};
	function program(name) {
		if (progs[name]) return progs[name];
		const sh = (type, src) => {
			const s = gl.createShader(type);
			gl.shaderSource(s, src);
			gl.compileShader(s);
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(name, gl.getShaderInfoLog(s));
			return s;
		};
		const p = gl.createProgram();
		gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
		gl.attachShader(p, sh(gl.FRAGMENT_SHADER, SHADERS[name]));
		gl.bindAttribLocation(p, 0, "p");
		gl.linkProgram(p);
		const loc = {};
		return (progs[name] = { p, loc: (n) => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n))) });
	}

	// Render one effect at w x h, then copy it onto ctx.
	function render(name, ctx, w, h, uniforms, textures = []) {
		if (glc.width < w || glc.height < h) {
			glc.width = Math.max(glc.width, w);
			glc.height = Math.max(glc.height, h);
		}
		const pr = program(name);
		gl.useProgram(pr.p);
		gl.viewport(0, 0, w, h);
		gl.scissor(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.uniform2f(pr.loc("u_res"), w, h);
		for (const [k, v] of Object.entries(uniforms)) {
			const l = pr.loc(k);
			if (l === null) continue;
			Array.isArray(v) ? gl.uniform2f(l, v[0], v[1]) : gl.uniform1f(l, v);
		}
		textures.forEach(([uname, tex], i) => {
			gl.activeTexture(gl.TEXTURE0 + i);
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.uniform1i(pr.loc(uname), i);
		});
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		ctx.clearRect(0, 0, w, h);
		ctx.drawImage(glc, 0, glc.height - h, w, h, 0, 0, w, h);
	}

	function texture() {
		const t = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, t);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return t;
	}
	function upload(t, source) {
		gl.bindTexture(gl.TEXTURE_2D, t);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	}

	const effects = [];
	const watch = new IntersectionObserver((entries) => {
		for (const e of entries) {
			const fx = effects.find((f) => f.host === e.target);
			if (fx) fx.visible = e.isIntersecting;
		}
	}, { rootMargin: "100px" });
	function add(fx) {
		fx.visible = false;
		effects.push(fx);
		watch.observe(fx.host);
		return fx;
	}

	// A 2D canvas that follows its host's size (in device pixels, capped).
	function surface(canvas, maxDpr = 1) {
		const ctx = canvas.getContext("2d");
		const s = { canvas, ctx, w: 1, h: 1, dpr: 1 };
		s.fit = () => {
			s.dpr = Math.min(devicePixelRatio || 1, maxDpr);
			s.w = Math.max(1, Math.round(canvas.clientWidth * s.dpr));
			s.h = Math.max(1, Math.round(canvas.clientHeight * s.dpr));
			if (canvas.width !== s.w || canvas.height !== s.h) { canvas.width = s.w; canvas.height = s.h; }
		};
		s.fit();
		return s;
	}

	/* ---------- chrome text ---------- */
	// el already holds split letters (.w > .ch). The letters stay in the page
	// for layout and animation but turn invisible; every frame their current
	// positions (including GSAP's moves) are redrawn into a texture.
	function chrome(el, { bevel = 7, gsap }) {
		const canvas = document.createElement("canvas");
		canvas.className = "fx-chrome";
		canvas.setAttribute("aria-hidden", "true");
		el.append(canvas);
		el.classList.add("chromed");
		const out = surface(canvas, 1.5);
		const sharp = document.createElement("canvas"), blur = document.createElement("canvas");
		const sctx = sharp.getContext("2d"), bctx = blur.getContext("2d");
		const tSharp = texture(), tBlur = texture();
		const words = [...el.querySelectorAll(".w")].map((w) => ({ w, chars: [...w.querySelectorAll(".ch")] }));
		let key = "", metrics = null;
		const fx = add({ host: el });
		fx.layout = () => {
			out.fit();
			sharp.width = blur.width = out.w;
			sharp.height = blur.height = out.h;
			const cs = getComputedStyle(el);
			const size = parseFloat(cs.fontSize);
			const font = `700 ${size}px "CMU Serif"`;
			sctx.font = font;
			const m = sctx.measureText("godspeed");
			metrics = { size, font, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
			// The canvas overhangs the element a bit, so glyph edges aren't cut.
			metrics.ox = canvas.offsetLeft;
			metrics.oy = canvas.offsetTop;
			key = "";
		};
		fx.render = (t, mouse) => {
			if (!metrics) fx.layout();
			const s = out.dpr, M = metrics;
			// Redraw the letters only when something moved.
			let k = "";
			const pos = words.map(({ w, chars }) => ({
				w,
				chars: chars.map((c) => {
					const v = [gsap.getProperty(c, "yPercent"), gsap.getProperty(c, "y"), gsap.getProperty(c, "rotation"), gsap.getProperty(c, "opacity")];
					k += v.join(",") + ";";
					return { c, v };
				}),
			}));
			if (k !== key) {
				key = k;
				sctx.setTransform(s, 0, 0, s, -M.ox * s, -M.oy * s);
				sctx.clearRect(M.ox, M.oy, out.w / s, out.h / s);
				sctx.font = M.font;
				sctx.fillStyle = "#fff";
				sctx.textBaseline = "alphabetic";
				for (const { w, chars } of pos) {
					sctx.save();
					sctx.beginPath();
					sctx.rect(w.offsetLeft - 40, w.offsetTop, w.offsetWidth + 80, w.offsetHeight);
					sctx.clip();
					for (const { c, v } of chars) {
						const H = c.offsetHeight;
						const base = (H - (M.asc + M.desc)) / 2 + M.asc;
						const x = c.offsetLeft, y = c.offsetTop + (v[0] / 100) * H + v[1];
						sctx.globalAlpha = v[3];
						sctx.save();
						sctx.translate(x + c.offsetWidth / 2, y + H / 2);
						sctx.rotate((v[2] * Math.PI) / 180);
						sctx.fillText(c.textContent, -c.offsetWidth / 2, base - H / 2);
						sctx.restore();
					}
					sctx.restore();
				}
				sctx.globalAlpha = 1;
				bctx.clearRect(0, 0, out.w, out.h);
				bctx.filter = `blur(${bevel * s}px)`;
				bctx.drawImage(sharp, 0, 0);
				bctx.filter = "none";
				upload(tSharp, sharp);
				upload(tBlur, blur);
			}
			const r = canvas.getBoundingClientRect();
			const mu = mouse[0] < 0 || !r.width
				? [out.w * 0.5, out.h * 2.2]
				: [((mouse[0] - r.left) / r.width) * out.w, (1 - (mouse[1] - r.top) / r.height) * out.h];
			render("chrome", out.ctx, out.w, out.h, { u_time: t, u_mouse: mu, u_k: 3 * (7 / bevel) }, [["u_content", tSharp], ["u_height", tBlur]]);
		};
		return fx;
	}

	/* ---------- overlays driven by a value ---------- */
	function simple(name, canvas, uniforms, maxDpr = 1) {
		const out = surface(canvas, maxDpr);
		const fx = add({ host: canvas, u: uniforms });
		fx.layout = () => out.fit();
		fx.render = (t) => render(name, out.ctx, out.w, out.h, { u_time: t, ...fx.u });
		return fx;
	}
	const forget = (canvas) => simple("forget", canvas, { u_amount: 0 });
	const strip = (canvas, pos, phase) => simple("strip", canvas, { u_pos: pos, u_phase: phase }, 2);
	const fork = (canvas) => simple("fork", canvas, { u_p: 0 }, 1.5);

	function shimmer(btn, light) {
		const canvas = document.createElement("canvas");
		canvas.className = "fx-shimmer";
		canvas.setAttribute("aria-hidden", "true");
		btn.append(canvas);
		const fx = simple("shimmer", canvas, { u_on: 0, u_light: light ? 1 : 0 });
		let target = 0, t0 = 0;
		btn.addEventListener("mouseenter", () => { target = 1; t0 = performance.now(); });
		btn.addEventListener("mouseleave", () => { target = 0; });
		const base = fx.render;
		fx.render = () => {
			fx.u.u_on += (target - fx.u.u_on) * 0.12;
			if (fx.u.u_on < 0.01 && target === 0) {
				if (fx.drawn) { canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); fx.drawn = false; }
				return;
			}
			fx.drawn = true;
			base((performance.now() - t0) / 1000);
		};
		return fx;
	}

	return {
		chrome, forget, strip, fork, shimmer,
		layout() { for (const f of effects) f.layout(); },
		tick(t, mouse) { for (const f of effects) if (f.visible) f.render(t, mouse); },
	};
}
