import { rampColor } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { percent } from "./runway-model";

/** Inner radius / outer radius. */
const INNER = 0.86;

/**
 * A deadline's ready % as a ring (the runway's and the deadline page's):
 * a grey track, an arc in the confidence color, the % in the middle, and
 * "–" when nothing is covered. `hover` lightens the track on hover of the
 * nearest `group`.
 */
export function ReadyRing({ ready, size, hover = false }: { ready: number | null; size: number; hover?: boolean }) {
	const outer = size / 2;
	const width = outer * (1 - INNER);
	const r = outer - width / 2;
	const length = 2 * Math.PI * r;
	return (
		<span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
				<circle
					cx={outer}
					cy={outer}
					r={r}
					fill="none"
					strokeWidth={width}
					className={cn("stroke-tone-2", hover && "group-hover:stroke-edge group-focus-visible:stroke-edge")}
				/>
				{ready !== null && ready > 0 && (
					<circle
						data-testid="runway-arc"
						cx={outer}
						cy={outer}
						r={r}
						fill="none"
						strokeWidth={width}
						style={{ stroke: rampColor(ready) }}
						strokeDasharray={`${length * Math.min(1, ready)} ${length}`}
					/>
				)}
			</svg>
			<span className="relative font-mono text-[18px] font-bold tabular-nums text-ink">{ready !== null ? `${percent(ready)}%` : "–"}</span>
		</span>
	);
}
