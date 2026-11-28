import type { CSSProperties, ReactNode } from "react";
import type { SpaceColor } from "@/shared/core";
import { spaceLineColor } from "@/frontend/components/space-color";
import { CountBlock } from "@/frontend/components/ui/count-block";

/**
 * A deadline that is not all there yet, drawn as its outline: dashes in its space's color where a
 * row's sheet would be, its day where a row's block is (when it has one, as a row draws it but with
 * no fill), its name, one line under it and its keys at the row's end. An interview waiting for its
 * date and a deadline that looks missing (an outline) are drawn with it.
 */
export function OutlineRow({
	testid,
	color,
	count,
	name,
	line,
	keys,
}: {
	testid: string;
	color: SpaceColor;
	/** The time left until its day ("3" over "days"); left out with no day. */
	count?: { count: string; unit: string };
	name: string;
	line: ReactNode;
	keys: ReactNode;
}) {
	return (
		<div data-testid={testid} style={{ "--lh-dash": spaceLineColor(color) } as CSSProperties} className="lh-dashed flex h-full min-h-[84px] items-center">
			{count && <CountBlock size="list" color={null} {...count} />}
			<span className="flex min-w-0 flex-1 flex-col gap-[3px] px-(--lh-inset) py-3">
				<span className="text-xl leading-tight break-words text-ink">{name}</span>
				<span className="text-ui leading-snug text-ink-2">{line}</span>
			</span>
			<span className="flex shrink-0 items-center gap-2.5 pr-(--lh-inset)">{keys}</span>
		</div>
	);
}
