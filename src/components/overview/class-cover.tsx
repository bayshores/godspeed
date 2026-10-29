import { memo, useMemo } from "react";
import katex from "katex";
import type { ClassNote, ClassSignature } from "@/core";
import { HalleyFace } from "@/components/halley/halley-face";
import { cn } from "@/lib/utils";
import { labelHangsLeft, studiedShare } from "./class-cover-model";

/**
 * THE CLASS COVER (top of a class's Overview, pen board 10b · H2): the
 * class's signature set huge and dim behind its name, inked a shade
 * brighter as far as the learner has studied; a progress line along the
 * bottom; Halley's note (set_class_note) on top.
 */

/** A signature in its own type: math through KaTeX, code in mono, text in
 *  the KaTeX serif italic (Computer Modern, like the titles). */
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

export const ClassCover = memo(function ClassCover({
	classId,
	name,
	description,
	signature,
	note,
	facts,
}: {
	classId: string;
	name: string;
	description: string;
	signature?: ClassSignature;
	note?: ClassNote;
	/** Facts studied of all the class's facts; null while loading. */
	facts: { studied: number; total: number } | null;
}) {
	const share = facts ? studiedShare(facts) : 0;
	const pct = Math.round(share * 100);
	const ink = { transition: "clip-path 600ms ease, width 600ms ease" };
	return (
		<header data-testid="class-cover" data-halley-target={`class:${classId}`} className="@container relative overflow-hidden px-[52px] pt-10 pb-7">
			{signature && (
				<div
					data-testid="class-cover-signature"
					aria-hidden
					className={cn(
						"pointer-events-none absolute top-1/2 left-[28%] -translate-y-1/2 leading-none select-none",
						signature.kind === "math" ? "text-[110px]" : "text-[180px]",
					)}
				>
					<SignatureText signature={signature} className="text-tone" />
					<div className="absolute inset-0 text-tone-2" style={{ ...ink, clipPath: `inset(0 ${100 - share * 100}% 0 0)` }}>
						<SignatureText signature={signature} />
					</div>
				</div>
			)}
			<div className="relative flex flex-col gap-6 @4xl:flex-row @4xl:items-end @4xl:justify-between">
				<div className="flex min-w-0 flex-col gap-2">
					<h1 data-testid="overview-name" className="font-title text-[40px] leading-[48px] tracking-tight text-ink">
						{name}
					</h1>
					{description && <p className="max-w-[640px] text-base text-ink-2">{description}</p>}
				</div>
				{note && (
					<div data-testid="class-cover-note" className="flex shrink-0 items-center gap-3 bg-panel/90 px-3.5 py-3 @4xl:w-[440px]">
						<span className="size-[22px] shrink-0">
							<HalleyFace mood="idle" still />
						</span>
						<p className="text-sm leading-snug text-ink">{note.text}</p>
					</div>
				)}
			</div>
			{facts && facts.total > 0 && (
				<div data-testid="class-cover-progress" className="relative mt-8 h-[2px] bg-tone">
					<div className="h-full bg-ink" style={{ ...ink, width: `${pct}%` }} />
					<span
						className={cn("absolute bottom-2 font-mono text-xs whitespace-nowrap text-ink-3", labelHangsLeft(share) && "-translate-x-full")}
						style={{ left: `${pct}%` }}
					>
						{pct}% studied
					</span>
				</div>
			)}
		</header>
	);
});
