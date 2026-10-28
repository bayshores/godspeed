// Ticker: scrolls the node's own rendering sideways forever (it wraps, so the
// row must repeat seamlessly across its width) and sweeps a soft shine across it.
precision highp float;

/** @resolution */
uniform vec2 u_res;

/** @time */
uniform float u_time;

/** @label Content */
uniform sampler2D u_content;

/**
 * @label Speed (widths per second, negative = right)
 * @default 0.02
 * @range -0.2, 0.2
 */
uniform float u_speed;

/**
 * @label Shine
 * @default 0.45
 * @range 0, 1
 */
uniform float u_shine;

void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec2 s = vec2(fract(uv.x + u_time * u_speed), uv.y);
	vec4 c = texture2D(u_content, s);
	float band = fract(uv.x * 0.6 - u_time * 0.12);
	float shine = exp(-pow((band - 0.5) * 9.0, 2.0));
	c.rgb += c.a * shine * u_shine * vec3(1.0);
	gl_FragColor = vec4(min(c.rgb, vec3(c.a)), c.a);
}
