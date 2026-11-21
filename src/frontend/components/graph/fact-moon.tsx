/** A fact's pixel moon drawn at any size, crisp: its answer record as an object. */
import { MOON_HALF, moonPaths } from "./constellation-moon.ts";
import type { FactProgress } from "@/shared/core";

/** `size` is a multiple of the moon's 18 points, so every pixel stays square. */
export function FactMoon({ fact, size }: { fact: Pick<FactProgress, "answers" | "inLessons">; size: number }) {
	return (
		<svg aria-hidden width={size} height={size} viewBox={`0 0 ${MOON_HALF * 2} ${MOON_HALF * 2}`} shapeRendering="crispEdges" className="shrink-0">
			{moonPaths(fact, MOON_HALF, MOON_HALF).map((p, i) => (
				<path key={i} fill={p.fill} d={p.d} />
			))}
		</svg>
	);
}
