// godspeed hero sky: twinkling stars, a comet that flies in and drops topic
// dots, dots lighting red -> green, links joining them, a glow under the mouse.
// Drawn in a 1440 x 960 design space (same as the landing hero).
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/** @mouse */
uniform vec2 u_mouse;

/**
 * @label Mirror (comet from the right)
 * @default 0
 * @range 0, 1
 */
uniform float u_mirror;

/**
 * @label All green (everything learned)
 * @default 0
 * @range 0, 1
 */
uniform float u_green;

/**
 * @label Loop length (s)
 * @default 12
 * @range 6, 30
 */
uniform float u_period;

const vec2 TAIL0 = vec2(-80.0, 1060.0);
const vec2 HEAD = vec2(1300.0, 190.0);
const float FLY = 2.4;

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
	if (i == 0) return vec2(0, 1);
	if (i == 1) return vec2(2, 1);
	if (i == 2) return vec2(1, 3);
	if (i == 3) return vec2(2, 4);
	if (i == 4) return vec2(4, 3);
	if (i == 5) return vec2(3, 5);
	if (i == 6) return vec2(4, 7);
	if (i == 7) return vec2(5, 6);
	if (i == 8) return vec2(7, 6);
	if (i == 9) return vec2(6, 8);
	if (i == 10) return vec2(7, 9);
	if (i == 11) return vec2(8, 10);
	if (i == 12) return vec2(9, 10);
	if (i == 13) return vec2(9, 11);
	if (i == 14) return vec2(10, 12);
	if (i == 15) return vec2(11, 12);
	if (i == 16) return vec2(8, 13);
	if (i == 17) return vec2(13, 14);
	if (i == 18) return vec2(12, 14);
	if (i == 19) return vec2(14, 15);
	if (i == 20) return vec2(14, 16);
	if (i == 21) return vec2(15, 17);
	if (i == 22) return vec2(15, 18);
	if (i == 23) return vec2(17, 19);
	if (i == 24) return vec2(16, 19);
	return vec2(18, 17);
}

vec3 ramp(float s) {
	if (s < 0.5) return vec3(0.937, 0.267, 0.267);
	if (s < 1.5) return vec3(0.976, 0.451, 0.086);
	if (s < 2.5) return vec3(0.918, 0.702, 0.031);
	if (s < 3.5) return vec3(0.518, 0.800, 0.086);
	return vec3(0.063, 0.725, 0.506);
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float segDist(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a, ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

// How far along the flight (0..1 of the eased path) a dot sits.
float pathParam(vec2 d) {
	vec2 ab = HEAD - TAIL0;
	return clamp(dot(d - TAIL0, ab) / dot(ab, ab), 0.0, 1.0);
}

// Seconds into the loop when the comet passes path param s.
float passTime(float s) {
	return FLY * (1.0 - pow(1.0 - s, 1.0 / 3.0));
}

void main() {
	float scale = 1440.0 / u_res.x;
	vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) * scale;
	if (u_mirror > 0.5) p.x = 1440.0 - p.x;

	float period = max(u_period, 6.0);
	float t = mod(u_time + 6.0, period);
	float fade = smoothstep(0.0, 0.4, t) * (1.0 - smoothstep(period - 1.4, period - 0.2, t));
	float x = clamp(t / FLY, 0.0, 1.0);
	float e = 1.0 - pow(1.0 - x, 3.0);
	vec2 comet = mix(TAIL0, HEAD, e);
	vec2 dir = normalize(HEAD - TAIL0);

	vec3 col = vec3(0.0);

	// Stars: one per 36px cell, about a quarter of cells lit, twinkling.
	vec2 cell = floor(p / 36.0);
	float h = hash(cell);
	if (h > 0.74) {
		vec2 sp = (cell + vec2(hash(cell + 3.1), hash(cell + 7.7))) * 36.0;
		float tw = 0.5 + 0.5 * sin(u_time * (0.8 + h * 2.2) + h * 40.0);
		float sd = length(p - sp);
		col += vec3(0.85) * smoothstep(1.4, 0.2, sd) * (0.25 + 0.75 * tw) * (h - 0.74) * 3.0;
	}

	// Links appear once both their dots are lit.
	for (int i = 0; i < 26; i++) {
		vec2 l = linkAt(i);
		vec4 a = dotAt(int(l.x));
		vec4 b = dotAt(int(l.y));
		float ta = passTime(pathParam(a.xy));
		float tb = passTime(pathParam(b.xy));
		float on = smoothstep(0.0, 0.6, t - max(ta, tb) - 0.2);
		float d = segDist(p, a.xy, b.xy);
		vec3 lc = mix(vec3(1.0), vec3(0.063, 0.725, 0.506), u_green);
		col += lc * smoothstep(1.2, 0.0, d) * 0.2 * on;
	}

	// Topic dots: pop in as the comet passes, gray first, then their color.
	for (int i = 0; i < 20; i++) {
		vec4 dd = dotAt(i);
		float ti = passTime(pathParam(dd.xy));
		float pop = smoothstep(0.0, 0.25, t - ti);
		float lit = smoothstep(0.3, 1.2, t - ti);
		vec3 c = mix(ramp(dd.w), ramp(4.0), u_green);
		c = mix(vec3(0.35), c, lit);
		float d = length(p - dd.xy);
		float r = dd.z * (0.6 + 0.4 * pop);
		float breathe = 0.85 + 0.15 * sin(u_time * 1.6 + float(i) * 1.7);
		col += c * smoothstep(r + 0.8, r - 0.8, d) * pop;
		col += c * 0.55 * exp(-d / (dd.z * 2.2)) * pop * breathe;
		if (dd.z > 6.0) {
			float rr = dd.z * 2.2 + 2.0 * sin(u_time * 1.2 + float(i));
			col += c * 0.5 * smoothstep(1.4, 0.2, abs(d - rr)) * lit;
		}
	}

	// Comet tail: a wedge behind the head, as long as the distance flown.
	vec2 rel = p - comet;
	float along = dot(rel, -dir);
	float perp = abs(rel.x * dir.y - rel.y * dir.x);
	float tailLen = min(1700.0, length(comet - TAIL0) + 40.0);
	float k = clamp(along / tailLen, 0.0, 1.0);
	float w = 15.0 * (1.0 - k);
	float inTail = step(0.0, along) * step(along, tailLen) * smoothstep(w + 1.0, w - 1.0, perp);
	col += vec3(1.0) * inTail * pow(1.0 - k, 2.2) * 0.85;

	// Comet head and its halo; the halo breathes once the comet rests.
	float hd = length(p - comet);
	float rest = smoothstep(FLY - 0.2, FLY + 0.4, t);
	col += vec3(1.0) * smoothstep(15.5, 14.0, hd);
	col += vec3(1.0) * 0.35 * exp(-hd / 30.0);
	col += vec3(1.0) * (0.10 + 0.05 * sin(u_time * 2.0) * rest) * exp(-hd / 190.0);

	col *= fade;

	// Soft light under the mouse.
	if (u_mouse.x > 0.0 || u_mouse.y > 0.0) {
		float md = length(gl_FragCoord.xy - u_mouse) * scale;
		col += vec3(0.07) * exp(-md / 240.0);
	}

	gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
