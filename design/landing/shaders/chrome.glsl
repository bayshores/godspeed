// Chrome: turns the node's own text into polished metal. Height comes from a
// blurred copy of the letters, the normal from its slope, and the color from
// a studio-style reflection plus a light that follows the mouse.
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/** @mouse */
uniform vec2 u_mouse;

/** @label Content */
uniform sampler2D u_content;

/**
 * @label Bevel (px)
 * @default 7
 * @range 1, 20
 */
uniform float u_bevel;

float h(vec2 uv) {
	vec2 px = u_bevel / u_res;
	float s = texture2D(u_content, uv).a * 2.0;
	float w = 2.0;
	for (int i = 0; i < 12; i++) {
		float a = float(i) * 0.5236;
		vec2 o = vec2(cos(a), sin(a));
		s += texture2D(u_content, uv + o * px).a;
		s += texture2D(u_content, uv + o * px * 0.5).a;
		w += 2.0;
	}
	return s / w;
}

void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	float a = texture2D(u_content, uv).a;
	if (a < 0.002) { gl_FragColor = vec4(0.0); return; }
	vec2 e = vec2(1.5) / u_res;
	float dx = h(uv + vec2(e.x, 0.0)) - h(uv - vec2(e.x, 0.0));
	float dy = h(uv + vec2(0.0, e.y)) - h(uv - vec2(0.0, e.y));
	vec3 n = normalize(vec3(-dx * 3.0, -dy * 3.0, 1.0));
	vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
	// Studio: dark floor, bright horizon band, cool sky. Slowly drifting.
	float y = uv.y + r.y * 0.55 + 0.04 * sin(u_time * 0.35);
	vec3 env = mix(vec3(0.06), vec3(0.42, 0.44, 0.48), smoothstep(0.05, 0.42, y));
	env += vec3(1.0) * exp(-pow((y - 0.52) * 7.0, 2.0)) * 0.9;
	env = mix(env, vec3(0.78, 0.8, 0.86), smoothstep(0.6, 1.0, y));
	// Brushed grain along x.
	float g = fract(sin(floor(gl_FragCoord.y * 1.0) * 91.7) * 4375.5);
	env *= 0.94 + 0.06 * g;
	// Light under the mouse.
	vec2 m = u_mouse / u_res;
	vec3 l = normalize(vec3((m - uv) * vec2(u_res.x / u_res.y, 1.0) * 1.6, 0.7));
	float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
	// A soft sheen that sweeps across now and then.
	float band = fract(uv.x * 0.5 - uv.y * 0.15 - u_time * 0.06);
	float sweep = exp(-pow((band - 0.5) * 14.0, 2.0)) * 0.45;
	vec3 c = env + spec * 0.9 + sweep;
	gl_FragColor = vec4(clamp(c, 0.0, 1.0) * a, a);
}
