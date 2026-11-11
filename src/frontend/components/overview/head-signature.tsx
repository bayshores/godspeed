"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import katex from "katex";
import type { ClassSignature } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { fitScale, percent } from "./overview-model";

/** A signature in its own type: math through KaTeX, code in mono, text in
 *  the KaTeX serif italic. */
export const SignatureText = memo(function SignatureText({ signature, className }: { signature: ClassSignature; className?: string }) {
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

/** The most room a signature gets in the class head. */
const ROOM = { width: 300, height: 44 };

/**
 * THE CLASS'S SIGNATURE (the class head, on Progress): pale, inked over as
 * far as the class's facts are studied, with the share under it. A long or
 * tall one shrinks to fit. `share` is null until the progress has loaded.
 */
export const HeadSignature = memo(function HeadSignature({ signature, share }: { signature: ClassSignature; share: number | null }) {
	const ref = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState<{ width: number; height: number; scale: number } | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const natural = { width: el.offsetWidth, height: el.offsetHeight };
			const scale = fitScale(natural, ROOM);
			setFit({ width: natural.width * scale, height: natural.height * scale, scale });
		};
		measure();
		// The math's fonts load after the first paint.
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [signature]);
	return (
		<div data-testid="class-signature" className="flex flex-col gap-0.5">
			{/* Decorative: the class name says the same to a screen reader. */}
			<div aria-hidden className={cn("pointer-events-none relative select-none", !fit && "invisible")} style={fit ? { width: fit.width, height: fit.height } : undefined}>
				<div
					ref={ref}
					className={cn("absolute top-0 left-0 w-max origin-top-left leading-tight", signature.kind === "math" ? "text-[22px]" : "text-[26px]")}
					style={{ scale: String(fit?.scale ?? 1) }}
				>
					<SignatureText signature={signature} className="text-ink-2/40" />
					{share !== null && share > 0 && (
						<div data-testid="class-signature-ink" className="lh-ink absolute inset-0 text-ink-2" style={{ "--ink": `${share * 100}%` } as CSSProperties}>
							<SignatureText signature={signature} />
						</div>
					)}
				</div>
			</div>
			{share !== null && (
				<p data-testid="class-studied" className="font-count text-[15px] leading-tight text-ink-2">
					{percent(share)}% studied
				</p>
			)}
		</div>
	);
});
