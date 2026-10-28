// The fixed sky behind the whole page: twinkling stars, the topic
// constellation (hero version and the all-green closing version), the big
// comet (hero and ending only, always a straight tail), and short straight
// shooting stars that cross the screen when you reach a new section.

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_head;
uniform vec2 u_tailEnd;
uniform float u_headR;
uniform float u_cometVis;
uniform vec2 u_met0;
uniform vec2 u_met1;
uniform float u_metP;
uniform float u_conVis;
uniform float u_conMirror;
uniform float u_conGreen;
uniform float u_conT;
uniform float u_conShift;
uniform float u_starShift;

const vec2 T0 = vec2(-80.0, 1060.0);
const vec2 H0 = vec2(1300.0, 190.0);

vec4 dotAt(int i) {
	if (i == 0) return vec4(150.0, 860.0, 8.0, 0.0);
	if (i == 1) return vec4(260.0, 740.0, 5.5, 2.0);
	if (i == 2) return vec4(200.0, 640.0, 5.5, 4.0);
	if (i == 3) return vec4(380.0, 680.0, 8.0, 1.0);
	if (i == 4) return vec4(330.0, 560.0, 5.5, 3.0);
	if (i == 5) return vec4(470.0, 600.0, 5.5, 0.0);
	if (i == 6) return vec4(520.0, 480.0, 8.0, 2.0);
	if (i == 7) return vec4(420.0, 440.0, 5.5, 4.0);
	if (i == 8) return vec4(620.0, 510.0, 5.5, 1.0);
	if (i == 9) return vec4(600.0, 370.0, 8.0, 3.0);
	if (i == 10) return vec4(760.0, 420.0, 5.5, 0.0);
	if (i == 11) return vec4(700.0, 290.0, 5.5, 2.0);
	if (i == 12) return vec4(880.0, 340.0, 8.0, 4.0);
	if (i == 13) return vec4(820.0, 560.0, 5.5, 1.0);
	if (i == 14) return vec4(960.0, 460.0, 5.5, 3.0);
	if (i == 15) return vec4(1080.0, 340.0, 8.0, 0.0);
	if (i == 16) return vec4(1020.0, 600.0, 5.5, 2.0);
	if (i == 17) return vec4(1200.0, 440.0, 5.5, 4.0);
	if (i == 18) return vec4(1160.0, 260.0, 8.0, 1.0);
	return vec4(1300.0, 560.0, 5.5, 3.0);
}
vec2 linkAt(int i) {
	if (i == 0) return vec2(0, 1); if (i == 1) return vec2(2, 1); if (i == 2) return vec2(1, 3);
	if (i == 3) return vec2(2, 4); if (i == 4) return vec2(4, 3); if (i == 5) return vec2(3, 5);
	if (i == 6) return vec2(4, 7); if (i == 7) return vec2(5, 6); if (i == 8) return vec2(7, 6);
	if (i == 9) return vec2(6, 8); if (i == 10) return vec2(7, 9); if (i == 11) return vec2(8, 10);
	if (i == 12) return vec2(9, 10); if (i == 13) return vec2(9, 11); if (i == 14) return vec2(10, 12);
	if (i == 15) return vec2(11, 12); if (i == 16) return vec2(8, 13); if (i == 17) return vec2(13, 14);
	if (i == 18) return vec2(12, 14); if (i == 19) return vec2(14, 15); if (i == 20) return vec2(14, 16);
	if (i == 21) return vec2(15, 17); if (i == 22) return vec2(15, 18); if (i == 23) return vec2(17, 19);
	if (i == 24) return vec2(16, 19); return vec2(18, 17);
}
vec3 ramp(float s) {
	if (s < 0.5) return vec3(0.937, 0.267, 0.267);
	if (s < 1.5) return vec3(0.976, 0.451, 0.086);
	if (s < 2.5) return vec3(0.918, 0.702, 0.031);
	if (s < 3.5) return vec3(0.518, 0.800, 0.086);
	return vec3(0.063, 0.725, 0.506);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float segDist(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a, ba = b - a;
	float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
	return length(pa - ba * h);
}
float passTime(vec2 d) {
	vec2 ab = H0 - T0;
	float s = clamp(dot(d - T0, ab) / dot(ab, ab), 0.0, 1.0);
	return 2.4 * (1.0 - pow(1.0 - s, 1.0 / 3.0));
}

void main() {
	vec2 res = u_res / u_dpr;
	vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
	vec3 col = vec3(0.0);

	// Stars, drifting slower than the page.
	vec2 sp = p + vec2(0.0, u_starShift);
	vec2 cell = floor(sp / 38.0);
	float h = hash(cell);
	if (h > 0.72) {
		vec2 c = (cell + vec2(hash(cell + 3.1), hash(cell + 7.7))) * 38.0;
		float tw = 0.5 + 0.5 * sin(u_time * (0.7 + h * 2.4) + h * 40.0);
		col += vec3(0.9) * smoothstep(1.5, 0.2, length(sp - c)) * (0.2 + 0.8 * tw) * (h - 0.72) * 3.2;
	}

	// Constellation, fitted to the viewport like background-size: cover.
	if (u_conVis > 0.001) {
		float s = max(res.x / 1440.0, res.y / 960.0);
		vec2 o = (res - vec2(1440.0, 960.0) * s) * 0.5 + vec2(0.0, u_conShift);
		vec3 acc = vec3(0.0);
		for (int i = 0; i < 26; i++) {
			vec2 l = linkAt(i);
			vec4 a = dotAt(int(l.x));
			vec4 b = dotAt(int(l.y));
			float on = smoothstep(0.0, 0.6, u_conT - max(passTime(a.xy), passTime(b.xy)) - 0.2);
			vec2 pa = o + a.xy * s; vec2 pb = o + b.xy * s;
			if (u_conMirror > 0.5) { pa.x = res.x - pa.x; pb.x = res.x - pb.x; }
			vec3 lc = mix(vec3(1.0), ramp(4.0), u_conGreen);
			acc += lc * smoothstep(1.2, 0.0, segDist(p, pa, pb)) * 0.2 * on;
		}
		for (int i = 0; i < 20; i++) {
			vec4 d = dotAt(i);
			float ti = passTime(d.xy);
			float pop = smoothstep(0.0, 0.25, u_conT - ti);
			float lit = smoothstep(0.3, 1.2, u_conT - ti);
			vec3 c = mix(ramp(d.w), ramp(4.0), u_conGreen);
			c = mix(vec3(0.35), c, lit);
			vec2 dp = o + d.xy * s;
			if (u_conMirror > 0.5) dp.x = res.x - dp.x;
			float r = d.z * (0.6 + 0.4 * pop) * min(s, 1.3);
			float dist = length(p - dp);
			float br = 0.85 + 0.15 * sin(u_time * 1.6 + float(i) * 1.7);
			acc += c * smoothstep(r + 0.8, r - 0.8, dist) * pop;
			acc += c * 0.55 * exp(-dist / (d.z * 2.2)) * pop * br;
			if (d.z > 6.0) {
				float rr = r * 2.2 + 2.0 * sin(u_time * 1.2 + float(i));
				acc += c * 0.5 * smoothstep(1.4, 0.2, abs(dist - rr)) * lit;
			}
		}
		col += acc * u_conVis;
	}

	// Big comet: a straight tapered wedge from the head back to the tail end.
	if (u_cometVis > 0.001) {
		vec2 ax = u_head - u_tailEnd;
		float L = max(length(ax), 1.0);
		vec2 dir = ax / L;
		vec2 rel = p - u_head;
		float along = dot(rel, -dir);
		float perp = abs(rel.x * dir.y - rel.y * dir.x);
		float k = clamp(along / L, 0.0, 1.0);
		float w = u_headR * (1.0 - k);
		float inTail = step(0.0, along) * step(along, L) * smoothstep(w + 1.0, w - 1.0, perp);
		float c = inTail * pow(1.0 - k, 2.2) * 0.85;
		float hd = length(rel);
		c += smoothstep(u_headR + 0.6, u_headR - 1.0, hd);
		c += 0.35 * exp(-hd / (u_headR * 2.0));
		c += (0.09 + 0.03 * sin(u_time * 2.0)) * exp(-hd / (u_headR * 12.0));
		col += vec3(c * u_cometVis);
	}

	// Shooting star: a thin straight streak, quick in, fades out.
	if (u_metP > 0.0 && u_metP < 1.0) {
		float e = 1.0 - pow(1.0 - u_metP, 3.0);
		vec2 mh = mix(u_met0, u_met1, e);
		vec2 md = normalize(u_met1 - u_met0);
		float ml = length(u_met1 - u_met0) * min(u_metP * 1.8, 0.45);
		vec2 rel = p - mh;
		float along = dot(rel, -md);
		float perp = abs(rel.x * md.y - rel.y * md.x);
		float k = clamp(along / ml, 0.0, 1.0);
		float fade = 1.0 - smoothstep(0.55, 1.0, u_metP);
		float streak = step(0.0, along) * step(along, ml) * smoothstep(1.4 * (1.0 - k) + 0.6, 0.0, perp) * pow(1.0 - k, 1.6);
		float glow = exp(-length(rel) / 5.0);
		col += vec3(0.95) * (streak * 0.9 + glow * 0.8) * fade;
	}

	// Soft light under the mouse.
	if (u_mouse.x > 0.0) col += vec3(0.06) * exp(-length(p - u_mouse) / 240.0);

	gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}`;

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

export function createSky(canvas) {
	const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
	if (!gl) return null;
	const sh = (type, src) => {
		const s = gl.createShader(type);
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
		return s;
	};
	const prog = gl.createProgram();
	gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
	gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
	gl.linkProgram(prog);
	gl.useProgram(prog);
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const loc = gl.getAttribLocation(prog, "a");
	gl.enableVertexAttribArray(loc);
	gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
	const U = {};
	for (const n of ["u_res", "u_dpr", "u_time", "u_mouse", "u_head", "u_tailEnd", "u_headR", "u_cometVis", "u_met0", "u_met1", "u_metP", "u_conVis", "u_conMirror", "u_conGreen", "u_conT", "u_conShift", "u_starShift"]) {
		U[n] = gl.getUniformLocation(prog, n);
	}
	let dpr = 1;
	const resize = () => {
		// The sky is soft by nature, so it renders at (at most) 1 pixel per CSS pixel.
		dpr = Math.min(window.devicePixelRatio || 1, 1);
		canvas.width = Math.round(innerWidth * dpr);
		canvas.height = Math.round(innerHeight * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
	};
	resize();
	addEventListener("resize", resize);

	return {
		draw(s) {
			gl.uniform2f(U.u_res, canvas.width, canvas.height);
			gl.uniform1f(U.u_dpr, dpr);
			gl.uniform1f(U.u_time, s.time);
			gl.uniform2f(U.u_mouse, s.mouse[0], s.mouse[1]);
			gl.uniform2f(U.u_head, s.head[0], s.head[1]);
			gl.uniform2f(U.u_tailEnd, s.tailEnd[0], s.tailEnd[1]);
			gl.uniform1f(U.u_headR, s.headR);
			gl.uniform1f(U.u_cometVis, s.cometVis);
			gl.uniform2f(U.u_met0, s.met0[0], s.met0[1]);
			gl.uniform2f(U.u_met1, s.met1[0], s.met1[1]);
			gl.uniform1f(U.u_metP, s.metP);
			gl.uniform1f(U.u_conVis, s.conVis);
			gl.uniform1f(U.u_conMirror, s.conMirror);
			gl.uniform1f(U.u_conGreen, s.conGreen);
			gl.uniform1f(U.u_conT, s.conT);
			gl.uniform1f(U.u_conShift, s.conShift);
			gl.uniform1f(U.u_starShift, s.starShift);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		// Where the hero comet rests / starts, in viewport px.
		heroPoint(which, mirror = false) {
			const W = innerWidth, H = innerHeight;
			const sc = Math.max(W / 1440, H / 960);
			const ox = (W - 1440 * sc) / 2, oy = (H - 960 * sc) / 2;
			const pt = which === "head" ? [1300, 190] : [-80, 1060];
			let x = ox + pt[0] * sc;
			if (mirror) x = W - x;
			return [x, oy + pt[1] * sc];
		},
	};
}
