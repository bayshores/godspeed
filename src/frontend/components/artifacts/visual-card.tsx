import { useArtifactInvert } from "@/frontend/components/artifacts/use-artifact-invert";
import { InvertButton } from "@/frontend/components/artifacts/invert-button";
import { CARD, SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { ResultTag } from "@/frontend/components/result-tag";
import { cn } from "@/frontend/lib/utils";
import { useSessionMermaid } from "@/frontend/components/session-overlay";
import { saveText } from "@/frontend/components/artifacts/download";
import { DispatchCard } from "@/frontend/components/artifacts/dispatch-card";
import { SvgImage } from "@/frontend/components/artifacts/svg-image";
import type { ArtifactPartProps, VisualResult } from "@/shared/core";

/**
 * Visual artifact card: the tool part's output is the
 * dispatch ack, so the tool-call box is the DispatchCard (live status via
 * the chat view's jobs feed). The SVG itself renders from the steer message
 * (sub-agent result delivery) via VisualOutputCard.
 *
 * Both display modes use an SVG image document: generated markup and its
 * styles never join the app's DOM. Downloads still contain the original SVG.
 */

/** The svg root's DECLARED width in px, when there is one — the natural
 *  size the card displays at instead of stretching to full width.
 *  %, em, "auto", or a missing attribute → null (the caller
 *  falls back to full-width). Pure. */
function svgNaturalWidth(svg: string): number | null {
	const m = /<svg\b[^>]*?\bwidth\s*=\s*["']([^"']+)["'][^>]*>/i.exec(svg);
	if (!m) return null;
	const value = m[1]!.trim();
	const px = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
	if (!px) return null;
	const n = Number.parseFloat(px[1]!);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function VisualCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="visual" />;
}

/** The figure itself — exported: the steer card renders the delivered artifact. */
export function VisualOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const result = output as VisualResult | undefined;
	const overlay = useSessionMermaid();
	// Brightness inversion; the toggled state also feeds the fullscreen
	// overlay (openFigure).
	const [inverted, toggleInverted] = useArtifactInvert(messageId, initialInverted);
	const natural = result && typeof result.svg === "string" ? svgNaturalWidth(result.svg) : null;
	if (!result || typeof result.svg !== "string") {
		return (
			<div className={cn(CARD, "text-[15px] text-ink-2")}>
				Figure completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.svg.length === 0;
	if (failed) {
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
	return (
		/* A card around the figure: image first, then the caption row with
		   "Figure" left and the controls right. The wrapper carries the
		   natural-sizing law, so a narrow figure gets a narrow card. */
		<div
			className={cn(
				CARD,
				"flex flex-col gap-2 px-4 py-3",
				natural !== null ? "mx-auto w-fit max-w-full" : "w-full",
			)}
			data-testid="visual-card"
		>
			{/* Natural sizing: a declared-width svg sits at
			   ITS size; max-w-full still shrinks oversized ones to fit. No
			   declared size (viewBox-only, %-width) keeps the full-width law.
			   The invert filter rides the bg-white holder, so the backing flips
			   white→black together with the strokes; transparent areas ARE the
			   backing. */}
			<div
				className={
					natural !== null
						? "w-fit max-w-full overflow-hidden bg-white"
						: "w-full overflow-hidden bg-white"
				}
				style={{ filter: inverted ? "invert(1) hue-rotate(180deg)" : undefined }}
				data-testid="visual-svg"
			>
				<SvgImage
					svg={result.svg}
					width={natural ?? undefined}
					className={natural !== null ? "block h-auto max-w-full" : "block h-auto w-full"}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2.5">
				<span className="text-sm text-ink-2">Figure</span>
				<span className="flex-1" />
				<InvertButton label="Invert figure brightness" checked={inverted} onToggle={() => toggleInverted(!inverted)} />
				<button
					type="button"
					onClick={() => saveText("figure.svg", result.svg, "image/svg+xml")}
					data-testid="visual-download"
					className={SMALL_BTN}
				>
					Download figure as SVG
				</button>
				{overlay && (
					<button
						type="button"
						onClick={() => overlay.openFigure(result.svg, inverted)}
						data-testid="visual-open"
						className={SMALL_BTN}
					>
						Open figure fullscreen
					</button>
				)}
			</div>
		</div>
	);
}
