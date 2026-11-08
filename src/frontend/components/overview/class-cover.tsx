import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import katex from "katex";
import { DEFAULT_TEACHER_NAME, type ClassNote, type ClassSignature } from "@/shared/core";
import { TeacherSprite } from "@/frontend/components/halley/teacher-sprite";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { cn } from "@/frontend/lib/utils";
import { firstSentence, labelHangsLeft, noteWhen, signaturePlace, studiedShare } from "./class-cover-model";

/**
 * THE CLASS COVER (top of a class's Overview): the
 * class's signature set huge and dim behind its name, inked a shade
 * brighter as far as the learner has studied; the description's first
 * sentence; a progress line along the bottom; Halley's note
 * (set_class_note) on top.
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

/** The signature dim, with the studied share inked over it. The ink's
 *  edge is soft and eases in when the page opens (globals.css .lh-ink).
 *  Decorative: the class name says the same thing to a screen reader. */
const InkedSignature = memo(function InkedSignature({
	signature,
	share,
	className,
}: {
	signature: ClassSignature;
	share: number;
	className?: string;
}) {
	return (
		<div data-testid="class-signature-ink" aria-hidden className={cn("pointer-events-none relative leading-none select-none", className)}>
			<SignatureText signature={signature} className="text-tone" />
			{share > 0 && (
				<div className="lh-ink absolute inset-0 text-ink-3/60" style={{ "--ink": `${share * 100}%` } as CSSProperties}>
					<SignatureText signature={signature} />
				</div>
			)}
		</div>
	);
});

export const ClassCover = memo(function ClassCover({
	classId,
	name,
	description,
	signature,
	note,
	facts,
	nowMs,
	onAddSignature,
}: {
	classId: string;
	name: string;
	description: string;
	signature?: ClassSignature;
	note?: ClassNote;
	/** Facts studied of all the class's facts; null while loading. */
	facts: { studied: number; total: number } | null;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
	/** Shown as "Add a signature" while the class has none. */
	onAddSignature?: () => void;
}) {
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const share = facts ? studiedShare(facts) : 0;
	const pct = Math.round(share * 100);
	const about = firstSentence(description);
	const when = note && nowMs !== null ? noteWhen(note.at, nowMs) : "";
	// The signature sits in the free space beside the text, shrunk to fit
	// (a tall formula or a long line is never cut off at the edges).
	const coverRef = useRef<HTMLElement>(null);
	const signatureRef = useRef<HTMLDivElement>(null);
	const textRef = useRef<HTMLDivElement>(null);
	const noteRef = useRef<HTMLDivElement>(null);
	const [place, setPlace] = useState<{ left: number; scale: number } | null>(null);
	useLayoutEffect(() => {
		const cover = coverRef.current;
		const sig = signatureRef.current;
		const text = textRef.current;
		if (!cover || !sig || !text) return;
		const fit = () => {
			const origin = cover.getBoundingClientRect().left;
			const textRight = text.getBoundingClientRect().right - origin;
			const noteBox = noteRef.current?.getBoundingClientRect();
			// Only a note in the same row as the text (wide covers) bounds the space.
			const noteLeft = noteBox && noteBox.left - origin > textRight ? noteBox.left - origin : null;
			const padRight = parseFloat(getComputedStyle(cover).paddingRight) || 0;
			setPlace(
				signaturePlace(
					{ width: sig.offsetWidth, height: sig.offsetHeight },
					{ width: cover.clientWidth, height: cover.clientHeight, padRight },
					textRight,
					noteLeft,
				),
			);
		};
		fit();
		const observer = new ResizeObserver(fit);
		observer.observe(cover);
		observer.observe(sig);
		observer.observe(text);
		return () => observer.disconnect();
	}, [signature, note]);
	return (
		<header ref={coverRef} data-testid="class-cover" data-halley-target={`class:${classId}`} className="@container relative overflow-hidden px-[52px] pt-10 pb-7">
			{signature && (
				<div
					ref={signatureRef}
					className={cn("absolute top-1/2 -translate-y-1/2 origin-left", !place && "invisible")}
					style={{ left: place?.left ?? 0, scale: String(place?.scale ?? 1) }}
				>
					<InkedSignature signature={signature} share={share} className={signature.kind === "math" ? "text-[110px]" : "text-[180px]"} />
				</div>
			)}
			<div className="relative flex flex-col gap-6 @4xl:flex-row @4xl:items-end @4xl:justify-between">
				<div ref={textRef} className="flex min-w-0 flex-col gap-2">
					<h1 data-testid="overview-name" className="font-bold text-[40px] leading-[48px] tracking-tight text-ink">
						{name}
					</h1>
					{about && <p className="max-w-[640px] text-base text-ink-2">{about}</p>}
					{!signature && onAddSignature && (
						<button type="button" data-testid="class-cover-add-signature" onClick={onAddSignature} className="lh-press self-start text-sm text-ink-3 underline underline-offset-4 hover:text-ink">
							Add a signature
						</button>
					)}
				</div>
				{note && (
					<div ref={noteRef} data-testid="class-cover-note" className="flex shrink-0 items-center gap-3 bg-panel/90 px-3.5 py-3 @4xl:w-[440px]">
						<TeacherSprite mood="idle" className="w-[17px] shrink-0" />
						<div className="flex min-w-0 flex-col gap-1">
							<p className="text-sm leading-snug text-ink">{note.text}</p>
							{when && <p className="text-xs text-ink-3">{teacherName}, {when}</p>}
						</div>
					</div>
				)}
			</div>
			{facts && facts.total > 0 && (
				<div data-testid="class-cover-progress" className="relative mt-8 h-[2px] bg-tone">
					<div className="lh-grow h-full bg-ink" style={{ width: `${pct}%` }} />
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
