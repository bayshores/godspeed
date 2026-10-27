/**
 * The map's hover/focus tooltip for a topic: its answers as blocks, the
 * score and fact count, what it needs and leads to, and the click hint.
 * The map places it beside the ring (TooltipCard = the app's tooltip box
 * without a trigger).
 */
import type { TopicProgress } from "@/src/core";
import { TooltipCard } from "@/components/ui/tooltip";
import { TIP_ANSWER_CLASS } from "./derive.ts";

/** At most this many answer blocks (the newest). */
const MAX_BLOCKS = 12;

export function MapTooltip({
	topic,
	needs,
	leadsTo,
	style,
}: {
	topic: TopicProgress;
	needs: readonly Pick<TopicProgress, "name">[];
	leadsTo: readonly Pick<TopicProgress, "name">[];
	style?: React.CSSProperties;
}) {
	const facts = `${topic.members.length} ${topic.members.length === 1 ? "fact" : "facts"}`;
	const blocks = topic.answers.slice(-MAX_BLOCKS);
	return (
		<TooltipCard
			data-testid="topic-tooltip"
			title={topic.name}
			hint="Click for facts and practice"
			className="pointer-events-none absolute z-10 w-[232px] max-w-[232px]"
			style={style}
		>
			<div className="flex items-center gap-2">
				{blocks.length > 0 && (
					<div className="flex gap-0.5" aria-hidden>
						{blocks.map((a) => (
							<span key={`${a.chatId}:${a.toolCallId}`} className={`h-3 w-[7px] ${TIP_ANSWER_CLASS[a.outcome]}`} />
						))}
					</div>
				)}
				<span className="font-mono text-xs text-ink-2">
					{topic.answered > 0 ? `${topic.right}/${topic.answered} right` : "Not tested"} · {facts}
				</span>
			</div>
			{needs.length > 0 && <TipRow label="Needs" names={needs} />}
			{leadsTo.length > 0 && <TipRow label="Leads to" names={leadsTo} />}
		</TooltipCard>
	);
}

function TipRow({ label, names }: { label: string; names: readonly Pick<TopicProgress, "name">[] }) {
	return (
		<div className="flex items-baseline gap-2">
			<span className="w-[52px] shrink-0 text-xs text-ink-3">{label}</span>
			<span className="min-w-0 text-[12.5px] text-ink">{names.map((n) => n.name).join(", ")}</span>
		</div>
	);
}
