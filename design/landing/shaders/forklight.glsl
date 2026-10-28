// Fork light: a small comet of light runs along learnharness, turns down the
// branch into godspeed and lands on the version tag, which glows.
// Coordinates follow the 1248x200 fork diagram (y down).
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/**
 * @label Progress (-1 = loop on time)
 * @default -1
 * @range -1, 1
 */
uniform float u_p;

vec2 path(float t) {
	// 0..0.45 upstream line, 0.45..0.7 the curve, 0.7..1 the branch.
	if (t < 0.45) return vec2(mix(40.0, 700.0, t / 0.45), 50.0);
	if (t < 0.7) {
		float s = (t - 0.45) / 0.25;
		vec2 p0 = vec2(700.0, 50.0), p1 = vec2(780.0, 50.0), p2 = vec2(760.0, 140.0), p3 = vec2(860.0, 140.0);
		float u = 1.0 - s;
		return u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3;
	}
	return vec2(mix(860.0, 1170.0, (t - 0.7) / 0.3), 140.0);
}

void main() {
	vec2 q = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res * vec2(1248.0, 200.0);
	float p = u_p < 0.0 ? fract(u_time / 6.0) * 1.25 : u_p * 1.25;
	float glow = 0.0;
	for (int i = 0; i < 18; i++) {
		float t = p - float(i) * 0.012;
		if (t < 0.0 || t > 1.0) continue;
		float d = length(q - path(t));
		float k = 1.0 - float(i) / 18.0;
		glow += k * (exp(-d * d / 6.0) * 0.9 + exp(-d * d / 160.0) * 0.18);
	}
	// The tag lights up once the comet lands.
	float land = smoothstep(1.0, 1.04, p) * (1.0 - smoothstep(1.1, 1.25, p));
	vec2 tq = (q - vec2(1198.0, 140.0)) / vec2(44.0, 16.0);
	float tag = exp(-dot(tq, tq) * 0.6) * land;
	float a = clamp(glow + tag * 0.7, 0.0, 1.0);
	gl_FragColor = vec4(vec3(1.0) * a, a);
}
