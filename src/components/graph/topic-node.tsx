/**
 * One topic on the map (redesign plan, Phase 5): a ring sized by fact
 * count, an arc + glow colored by % right (gray track only when
 * untested), the fact count in the middle, and the name + score under it.
 * Memoized — hovering one topic redraws only the topics whose state
 * changed. Focusable: Tab reaches it, focus shows the hover ring and the
 * tooltip, Enter/Space selects it.
 */
import { memo, type KeyboardEvent } from "react";
import { RAMP_COLORS, type TopicProgress } from "@/core";
import type { PlacedTopic } from "./layout.ts";
import { OVERCONFIDENT_COLOR, scoreText } from "./derive.ts";

/** Faded topics (not on the picked deadline / not matching the search). */
export const FADED_OPACITY = 0.22;

/** The halo gradient id for a ramp color (defs live in the map). */
function haloId(color: string): string | null {
	const i = (RAMP_COLORS as readonly string[]).indexOf(color);
	return i < 0 ? null : `topic-halo-${i}`;
}

function topicAriaLabel(t: Pick<TopicProgress, "name" | "right" | "answered" | "overconfident" | "members">): string {
	const facts = `${t.members.length} ${t.members.length === 1 ? "fact" : "facts"}`;
	if (t.answered === 0) return `${t.name}, not tested, ${facts}`;
	return `${t.name}, ${t.right} of ${t.answered} right${t.overconfident ? ", overconfident" : ""}, ${facts}`;
}

interface TopicNodeProps {
	topic: TopicProgress;
	place: PlacedTopic;
	faded: boolean;
	hovered: boolean;
	selected: boolean;
	onHover: (id: string | null) => void;
	onSelect: (id: string) => void;
}

function TopicNodeImpl({ topic, place, faded, hovered, selected, onHover, onSelect }: TopicNodeProps) {
	const { d } = place;
	const tested = topic.answered > 0;
	const thick = d * 0.11;
	const mid = d / 2 - thick / 2;
	const halo = tested ? haloId(topic.color) : null;
	const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onSelect(topic.id);
		}
	};
	return (
		<g
			data-testid="topic-node"
			data-topic={topic.id}
			role="button"
			tabIndex={0}
			aria-label={topicAriaLabel(topic)}
			aria-pressed={selected}
			transform={`translate(${place.x} ${place.y})`}
			opacity={faded && !selected ? FADED_OPACITY : 1}
			className="cursor-pointer outline-none"
			style={{ transition: "opacity var(--lh-dur) var(--lh-ease-out)" }}
			onPointerEnter={() => onHover(topic.id)}
			onPointerLeave={() => onHover(null)}
			onFocus={() => onHover(topic.id)}
			onBlur={() => onHover(null)}
			onClick={() => onSelect(topic.id)}
			onKeyDown={onKeyDown}
		>
			{halo && <circle r={d * 1.3} fill={`url(#${halo})`} opacity={0.7} />}
			<circle r={d / 2} fill="#0B0B0B" />
			<circle r={mid} fill="none" stroke={tested ? "#FFFFFF1A" : "#FFFFFF26"} strokeWidth={thick} />
			{tested && (topic.rate ?? 0) > 0 && (
				<circle
					data-testid="topic-arc"
					r={mid}
					fill="none"
					stroke={topic.color}
					strokeWidth={thick}
					pathLength={100}
					strokeDasharray={`${Math.round((topic.rate ?? 0) * 1000) / 10} 100`}
					transform="rotate(-90)"
					style={{ filter: `drop-shadow(0 0 5px ${topic.color}80)` }}
				/>
			)}
			{selected && <circle r={d / 2 + 9} fill="none" stroke="#FFFFFF80" strokeWidth={1} />}
			{hovered && !selected && <circle r={d / 2 + 6.25} fill="none" stroke="#FFFFFF99" strokeWidth={1.5} />}
			<text
				className="font-mono"
				fontSize={Math.max(10, d * 0.275)}
				fontWeight={700}
				fill={tested ? "#E6E6E6" : "#8D8D8D"}
				textAnchor="middle"
				dominantBaseline="central"
			>
				{topic.members.length}
			</text>
			<foreignObject x={-80} y={d / 2 + 8} width={160} height={44}>
				<div className="flex flex-col items-center gap-0.5 text-center">
					<div
						className={`line-clamp-2 w-full text-[13px] leading-4 ${selected ? "font-extrabold text-white" : "font-semibold text-[#D6D6D6]"}`}
					>
						{topic.name}
					</div>
					<div className="flex items-center gap-1.5 text-[11.5px]">
						{tested ? (
							<>
								<span className="font-mono font-bold" style={{ color: topic.color }}>
									{scoreText(topic)}
								</span>
								{topic.overconfident && (
									<>
										<span className="size-[3px] bg-ink-3" aria-hidden />
										<span className="font-bold" style={{ color: OVERCONFIDENT_COLOR }}>
											overconfident
										</span>
									</>
								)}
							</>
						) : (
							<span className="text-ink-3">Not tested</span>
						)}
					</div>
				</div>
			</foreignObject>
		</g>
	);
}

export const TopicNode = memo(TopicNodeImpl);
