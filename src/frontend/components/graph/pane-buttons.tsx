/** The topic and fact panels' controls: the main Study key, the quiet Close, and the topic's tab back. */
import type { TopicProgress } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { topicColor } from "./derive.ts";

/** A panel's main key, as wide as its word, with why the last start failed under it. */
export function StudyButton({ onClick, busy, error, testid }: { onClick: () => void; busy: boolean; error: string | null; testid: string }) {
	return (
		<div className="flex shrink-0 flex-col items-end gap-2">
			<button type="button" data-testid={testid} disabled={busy} onClick={onClick} className="lh-btn lh-btn-main">
				Study
			</button>
			{error && (
				<p role="alert" data-testid="study-start-error" className="max-w-[32ch] text-right text-sm text-ans-wrong">
					{error}
				</p>
			)}
		</div>
	);
}

/** A panel's quiet Close: the close mark alone. */
export function CloseButton({ testid, onClick }: { testid: string; onClick: () => void }) {
	return (
		<button type="button" data-testid={testid} aria-label="Close" title="Close" onClick={onClick} className="lh-btn lh-btn-quiet lh-btn-small shrink-0">
			<PixelIcon name="close" />
		</button>
	);
}

/** The fact's topic as a folder tab standing on the panel's top edge; a click goes back to the topic. */
export function TopicTab({ topic, onClick }: { topic: TopicProgress; onClick: () => void }) {
	return (
		<button type="button" data-testid="fact-pane-back" onClick={onClick} className="lh-folder-tab lh-press absolute bottom-[calc(100%-8px)] left-0 flex h-11 max-w-[min(100%,36ch)] items-center gap-2.5 pt-0 pr-5 pb-2 pl-4 text-ui text-ink-2 hover:text-ink">
			<span aria-hidden className="size-[10px] shrink-0" style={{ background: topicColor(topic) }} />
			<span className="truncate">{topic.name}</span>
		</button>
	);
}
