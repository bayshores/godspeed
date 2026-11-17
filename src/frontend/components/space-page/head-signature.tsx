import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import katex from "katex";
import type { SpaceSignature } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { headSignatureScale } from "./space-head-model";

/** A signature in its own type: math through KaTeX, code in mono, text in
 *  the KaTeX serif italic. */
export const SignatureText = memo(function SignatureText({ signature, className }: { signature: SpaceSignature; className?: string }) {
	const html = useMemo(
		() =>
			signature.kind === "math"
				? katex.renderToString(signature.value, { throwOnError: false, errorColor: "currentColor", output: "html" })
				: null,
		[signature],
	);
	if (html !== null) return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
	return (
		<span className={cn("whitespace-pre", signature.kind === "code" ? "font-mono" : "font-[KaTeX_Main] italic", className)}>
			{signature.value}
		</span>
	);
});

/**
 * THE SPACE'S SIGNATURE (the space head): pale, inked over as far as the
 * space's facts are studied. It shrinks to fit its room in the tab row
 * and is left out when that would be too small to read. `share`
 * is null until the progress has loaded, and for a space with no facts.
 */
export const HeadSignature = memo(function HeadSignature({ signature, share }: { signature: SpaceSignature; share: number | null }) {
	const slot = useRef<HTMLDivElement>(null);
	const ref = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState<{ width: number; height: number; scale: number | null } | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		const free = slot.current;
		if (!el || !free) return;
		const measure = () => {
			const natural = { width: el.offsetWidth, height: el.offsetHeight };
			const scale = headSignatureScale(natural, free.clientWidth);
			setFit({ width: natural.width * (scale ?? 0), height: natural.height * (scale ?? 0), scale });
		};
		measure();
		// The math's fonts load after the first paint, and the window can narrow.
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		observer.observe(free);
		return () => observer.disconnect();
	}, [signature]);
	const shown = fit !== null && fit.scale !== null;
	return (
		// Its room in the tab row; the signature sits at its end.
		<div ref={slot} className="flex min-w-0 flex-1 basis-0 justify-end overflow-hidden">
			{/* Decorative: the top bar's tab names the space. */}
			<div
				data-testid="space-signature"
				aria-hidden
				className={cn("pointer-events-none relative shrink-0 select-none", !shown && "invisible")}
				style={fit ? { width: fit.width, height: fit.height } : undefined}
			>
				<div
					ref={ref}
					className={cn("absolute top-0 left-0 w-max origin-top-left leading-tight", signature.kind === "math" ? "text-[44px]" : "text-[48px]")}
					style={{ scale: String(fit?.scale ?? 1) }}
				>
					<SignatureText signature={signature} className="text-ink-2/65" />
					{share !== null && share > 0 && (
						<div data-testid="space-signature-ink" className="lh-ink absolute inset-0 text-ink" style={{ "--ink": `${share * 100}%` } as CSSProperties}>
							<SignatureText signature={signature} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
});
