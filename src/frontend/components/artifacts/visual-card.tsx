import { useMemo } from "react";
import { CARD, SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { ResultTag } from "@/frontend/components/result-tag";
import { cn } from "@/frontend/lib/utils";
import { useSessionMermaid } from "@/frontend/components/session-overlay";
import { useAppearance } from "@/frontend/components/settings/appearance";
import { saveText } from "@/frontend/components/artifacts/download";
import { SvgImage } from "@/frontend/components/artifacts/svg-image";
import { figureSize, themedFigure } from "@/frontend/components/artifacts/figure-model";
import type { ArtifactPartProps, VisualResult } from "@/shared/core";

/**
 * A figure the teacher drew, part of the reply like a diagram in its text: bare, in the theme's
 * colors, at the size it declares. Its markup stays in an image document, so its styles never
 * join the app's page. The keys in its corner show on hover, like a diagram's.
 */
function Figure({ svg }: { svg: string }) {
	const { figureInks } = useAppearance();
	const overlay = useSessionMermaid();
	const { themed, shown, size } = useMemo(() => {
		const themed = themedFigure(svg, figureInks);
		const shown = themed ?? svg;
		return { themed, shown, size: figureSize(shown) };
	}, [svg, figureInks]);
	const key = cn(SMALL_BTN, "opacity-0 focus-visible:opacity-100 group-hover/md:opacity-100");
	return (
		<div className="group/md relative my-4" data-testid="visual-card">
			{/* A figure with its own colors was drawn for a white page. */}
			<div className={cn("mx-auto max-w-full overflow-hidden", size ? "w-fit" : "w-full", themed === null && "bg-white")} data-testid="visual-svg">
				<SvgImage svg={shown} width={size?.width} height={size?.height} className={size ? "block h-auto max-w-full" : "block h-auto w-full"} />
			</div>
			<div className="absolute top-0 right-0 flex items-start gap-1.5">
				<button type="button" data-testid="visual-download" className={key} onClick={() => saveText("figure.svg", shown, "image/svg+xml")}>
					Download
				</button>
				{overlay && (
					<button type="button" data-testid="visual-open" className={key} onClick={() => overlay.openFigure(shown, themed === null)}>
						Open fullscreen
					</button>
				)}
			</div>
		</div>
	);
}

/** The teacher's `visual` call: its result holds the figure. A call from before the teacher drew
 *  figures itself holds a job's receipt, and its figure is the message under it. */
export function VisualCard({ part }: ArtifactPartProps) {
	const svg = (part.output as VisualResult | undefined)?.svg;
	return part.state === "output-available" && typeof svg === "string" ? <Figure svg={svg} /> : null;
}

/** A figure a background job delivered, in a lesson from before the teacher drew them itself. */
export function VisualOutputCard({ output }: { output: unknown }) {
	const result = output as VisualResult | undefined;
	if (!result || typeof result.svg !== "string") {
		return <div className={cn(CARD, "text-[15px] text-ink-2")}>Figure completed, but the result could not be displayed.</div>;
	}
	if (result.svg.length === 0) {
		return (
			<div className={cn(CARD, "flex flex-col gap-2 text-card-foreground")} data-testid="visual-card-failed">
				<div className="flex items-center gap-2.5 text-sm text-ink-2">
					Figure
					<ResultTag tone="wrong">failed</ResultTag>
				</div>
				<p className="text-[15px] text-ink-2">{result.notes ?? "The figure could not be drawn."}</p>
			</div>
		);
	}
	return <Figure svg={result.svg} />;
}
