/**
 * Halley's face: the logo comet's white dot with plain black
 * eyes. One SVG holds every mood; `data-mood` shows one of them and the
 * motion lives in globals.css (.lh-halley-face). The view box is the
 * dot itself, so the element's size is the dot's diameter; the thinking
 * dots and the z's sit outside it (overflow visible).
 */
import type { Ref } from "react";
import { cn } from "@/lib/utils";
import type { HalleyMood } from "./mood";

const INK = "#000";
const BODY = "#F2F2F2";
const BLUSH = "#FF8FA3";
const SWEAT = "#7CC7FF";

export function HalleyFace({
	mood,
	lookRef,
	still = false,
	className,
}: {
	mood: HalleyMood;
	/** The group the eyes move with (the engine sets its transform). */
	lookRef?: Ref<SVGGElement>;
	/** No motion at all (small copies, e.g. the panel's head). */
	still?: boolean;
	className?: string;
}) {
	return (
		<svg
			viewBox="20 20 200 200"
			data-mood={mood}
			data-testid="halley-face"
			aria-hidden
			className={cn("lh-halley-face block size-full overflow-visible", still && "hy-still", className)}
		>
			<g className="hy-bob">
				<circle cx="120" cy="120" r="100" fill={BODY} />
				<g className="hy-look" ref={lookRef}>
					<ellipse className="hy-mouth" cx="120" cy="152" rx="10" ry="8" fill={INK} />
					<g className="hy-face">
						<g className="hy-m-idle">
							<g className="hy-blink">
								<rect x="80" y="84" width="28" height="48" rx="14" fill={INK} />
								<rect x="132" y="84" width="28" height="48" rx="14" fill={INK} />
							</g>
						</g>
						<g className="hy-m-happy">
							<path d="M78 112 Q94 88 110 112" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
							<path d="M130 112 Q146 88 162 112" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
							<ellipse cx="72" cy="136" rx="14" ry="8" fill={BLUSH} opacity=".75" />
							<ellipse cx="168" cy="136" rx="14" ry="8" fill={BLUSH} opacity=".75" />
							<path d="M106 142 Q120 156 134 142" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />
						</g>
						<g className="hy-m-sparkle">
							<path className="hy-twinkle" d="M94 80 L101 101 L120 108 L101 115 L94 136 L87 115 L68 108 L87 101 Z" fill={INK} />
							<path className="hy-twinkle" d="M146 80 L153 101 L172 108 L153 115 L146 136 L139 115 L120 108 L139 101 Z" fill={INK} />
							<ellipse cx="70" cy="140" rx="12" ry="6" fill={BLUSH} opacity=".7" />
							<ellipse cx="170" cy="140" rx="12" ry="6" fill={BLUSH} opacity=".7" />
							<path d="M108 144 Q120 153 132 144" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
						</g>
						<g className="hy-m-thinking">
							<rect x="92" y="76" width="26" height="42" rx="13" fill={INK} />
							<rect x="142" y="76" width="26" height="42" rx="13" fill={INK} />
							<path d="M110 148 L128 143" stroke={INK} strokeWidth="6" strokeLinecap="round" />
							<g>
								<circle className="hy-pulse" cx="196" cy="40" r="8" fill={BODY} />
								<circle className="hy-pulse" cx="216" cy="22" r="6" fill={BODY} />
								<circle className="hy-pulse" cx="232" cy="6" r="4" fill={BODY} />
							</g>
						</g>
						<g className="hy-m-oops">
							<rect x="82" y="90" width="26" height="40" rx="13" fill={INK} />
							<rect x="132" y="90" width="26" height="40" rx="13" fill={INK} />
							<path d="M102 150 Q109 143 116 150 Q123 157 130 150 Q137 143 140 150" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
							<path className="hy-drip" d="M184 54 Q197 74 190 83 Q181 90 175 81 Q170 72 184 54 Z" fill={SWEAT} />
						</g>
						<g className="hy-m-shocked">
							<circle cx="94" cy="106" r="21" fill="none" stroke={INK} strokeWidth="7" />
							<circle cx="146" cy="106" r="21" fill="none" stroke={INK} strokeWidth="7" />
							<circle cx="94" cy="106" r="6" fill={INK} />
							<circle cx="146" cy="106" r="6" fill={INK} />
							<ellipse cx="120" cy="154" rx="10" ry="12" fill={INK} />
						</g>
						<g className="hy-m-dizzy">
							<path className="hy-spin" d="M94 106 m-17 0 a17 17 0 1 0 34 0 a12 12 0 1 0 -24 0 a6.5 6.5 0 1 0 13 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
							<path className="hy-spin" d="M146 106 m-17 0 a17 17 0 1 0 34 0 a12 12 0 1 0 -24 0 a6.5 6.5 0 1 0 13 0" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
							<path d="M107 150 Q113.5 143 120 150 Q126.5 157 133 150" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
						</g>
						<g className="hy-m-embarrassed">
							<path d="M80 92 L106 106 L80 120" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
							<path d="M160 92 L134 106 L160 120" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
							<ellipse cx="72" cy="136" rx="15" ry="8" fill={BLUSH} opacity=".85" />
							<ellipse cx="168" cy="136" rx="15" ry="8" fill={BLUSH} opacity=".85" />
							<path d="M109 148 L131 148" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
						</g>
						<g className="hy-m-sleepy">
							<path d="M78 112 L110 112" stroke={INK} strokeWidth="8" strokeLinecap="round" />
							<path d="M130 112 L162 112" stroke={INK} strokeWidth="8" strokeLinecap="round" />
							<ellipse cx="120" cy="148" rx="7" ry="4.5" fill={INK} />
							<text className="hy-zz" x="190" y="54" fill={BODY} fontSize="26" fontWeight="800" fontFamily="system-ui">
								z
							</text>
							<text className="hy-zz" x="208" y="36" fill={BODY} fontSize="18" fontWeight="800" fontFamily="system-ui">
								z
							</text>
						</g>
					</g>
				</g>
			</g>
		</svg>
	);
}
