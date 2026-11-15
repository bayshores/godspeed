import { Countdown } from "@/frontend/components/countdown";
import { FollowButton } from "./follow-button";
import { rowWords, type DueSoon, type PillThing } from "./live-pill-model";

/** The button of a row: what a click on the thing does. */
const ROW_BUTTON = {
	teacher: "Answer",
	ready: "Open",
	due: "Open",
	work: "Activity",
} as const;

/**
 * The pill's open card: a row per live thing with its button, then the
 * way to the teacher. `main` is the thing the pill itself names. A page
 * with a bar of its own has no teacher panel, so it shows neither Talk nor
 * Activity; a lesson has Follow beside its teacher, so its card has none.
 */
export function PillCard({ things, main, name, panel, follow, onAct, onTalk }: { things: readonly PillThing[]; main: PillThing | null; name: string; panel: boolean; follow: boolean; onAct: (thing: PillThing) => void; onTalk: () => void }) {
	return (
		<>
			{things.map((thing) => {
				const { title, sub } = rowWords(thing, main);
				const acts = thing.kind === "teacher" ? thing.action !== null : thing.kind !== "work" || panel;
				return (
					<div key={`${thing.kind}:${thing.key}`} data-testid={`pill-row-${thing.kind}`} className="lh-pill-row flex items-center gap-3 py-[11px] pr-3.5 pl-[18px]">
						<div className="min-w-0 flex-1">
							<p title={title} className="truncate text-[17px] text-ink">
								{title}
								{thing.due && !sub && <RowCountdown due={thing.due} />}
							</p>
							{sub && (
								<p className="truncate text-[15px] text-ink-2">
									{sub}
									{thing.due && <RowCountdown due={thing.due} />}
								</p>
							)}
						</div>
						{thing.kind === "teacher" && follow && <FollowButton />}
						{acts && (
							<button type="button" data-testid={`pill-act-${thing.kind}`} data-teacher-panel-toggle={thing.kind === "work" ? "" : undefined} onClick={() => onAct(thing)} className="lh-btn shrink-0">
								{ROW_BUTTON[thing.kind]}
							</button>
						)}
					</div>
				);
			})}
			{panel && (
				<div className="lh-pill-row flex justify-end px-3.5 pt-2.5 pb-3.5">
					<button type="button" data-testid="pill-talk" data-teacher-panel-toggle="" onClick={onTalk} className="lh-btn">
						Talk to {name}
					</button>
				</div>
			)}
		</>
	);
}

/** " 05:12:44" after a deadline's words. */
function RowCountdown({ due }: { due: DueSoon }) {
	return (
		<>
			{" "}
			<Countdown due={due} className="font-count" />
		</>
	);
}
