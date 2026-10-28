// Strip: one bar of the red-to-green ramp with a light that flows along it.
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/**
 * @label Ramp position (0 red, 1 green)
 * @default 0
 * @range 0, 1
 */
uniform float u_pos;

/**
 * @label Phase
 * @default 0
 * @range 0, 1
 */
uniform float u_phase;

vec3 ramp(float t) {
	vec3 a = vec3(0.937, 0.267, 0.267), b = vec3(0.976, 0.451, 0.086), c = vec3(0.918, 0.702, 0.031), d = vec3(0.518, 0.8, 0.086), e = vec3(0.063, 0.725, 0.506);
	t = clamp(t, 0.0, 1.0) * 4.0;
	return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : t < 3.0 ? mix(c, d, t - 2.0) : mix(d, e, t - 3.0);
}

void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec3 c = ramp(u_pos + uv.x * 0.25);
	float p = fract(u_time * 0.18 + u_phase);
	float d = uv.x - p;
	float pulse = exp(-d * d * 60.0) + exp(-pow(max(-d, 0.0), 1.0) * 9.0) * step(d, 0.0) * 0.25;
	gl_FragColor = vec4(c * (0.55 + pulse * 0.9) + vec3(1.0) * pulse * 0.35, 1.0);
}
