import { useState } from "react";
import { Link } from "react-router";
import { DEFAULT_TEACHER_NAME, TOPIC_NAME_MAX, weakestFirst, type PrepTopicProgress, type PrepView } from "@/shared/core";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useMinute } from "@/frontend/components/countdown";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { longDay } from "@/frontend/components/home-page/home-page-model";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { LoadFailed } from "@/frontend/components/load-failed";
import { TITLE } from "@/frontend/components/overview/styles";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { FIELD } from "@/frontend/components/ui/field";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { cn } from "@/frontend/lib/utils";
import { lastMockLine, mockHref, openMock, openMockLabel } from "./mock-model";
import { STATUS_WORD, formatLine, meterBoxes, prepCount, solidLine, solidShare } from "./prep-model";
import { useTakeMock } from "./use-mock";
import { usePrep } from "./use-prep";

/**
 * A PREP'S SHEET (its first tab): what the thing is like and where the
 * teacher found that, then what to study, weakest first, each topic with
 * how it is going. Beside it: the days left, the day itself, how many
 * topics are solid and the one Study button. A topic's row studies just
 * that topic.
 */
export function PrepSheet({ spaceId }: { spaceId: string }) {
	const { view, loadError, reload, act } = usePrep(spaceId);
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	if (!view) {
		return loadError ? <LoadFailed message="Couldn't load this prep." onRetry={() => void reload()} /> : null;
	}
	return (
		<div data-testid="prep-sheet" className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-[908px] px-6 pt-7 pb-16">
				{view.prep.writtenAt ? <Sheet view={view} teacher={teacher} act={act} /> : <NoSheetYet view={view} teacher={teacher} act={act} />}
			</div>
		</div>
	);
}

type Act = (body: Record<string, unknown>) => Promise<string | null>;

/** Before the first sheet: the teacher is writing it, or the write failed. */
function NoSheetYet({ view, teacher, act }: { view: PrepView; teacher: string; act: Act }) {
	if (view.writing) {
		return (
			<div data-testid="prep-writing" className="flex flex-col items-start gap-3 py-10">
				<p className="flex items-center gap-3 text-[23px] leading-snug text-ink">
					<BrailleSpinner className="h-5" label="Writing your prep sheet" />
					{teacher} is looking it up and writing your prep sheet
				</p>
				<p className="text-[17px] text-ink-2">This takes a few minutes. You can leave this page and come back.</p>
				<NoAgentLine />
			</div>
		);
	}
	return (
		<div data-testid="prep-failed" role="alert" className="flex flex-col items-start gap-3 py-10">
			<p className="text-[23px] leading-snug text-ink">The prep sheet wasn't written</p>
			<p className="text-[17px] text-ink-2">{view.error ? `What went wrong: ${view.error}.` : "The request stopped before the sheet came back."}</p>
			<button type="button" data-testid="prep-retry" onClick={() => void act({ action: "write" })} className="lh-btn lh-btn-main text-[15px]">
				Try again
			</button>
			<NoAgentLine />
		</div>
	);
}

function Sheet({ view, teacher, act }: { view: PrepView; teacher: string; act: Act }) {
	const { prep, topics, writing } = view;
	const lesson = useLessonStart();
	const spaceId = view.spaceId;
	const mock = useTakeMock(spaceId);
	const open = openMock(view.mocks);
	const [error, setError] = useState<string | null>(null);
	const run = async (body: Record<string, unknown>) => setError(await act(body));
	const ordered = weakestFirst(topics);
	return (
		<div className="flex flex-wrap items-start gap-x-10 gap-y-8">
			<div className="flex min-w-0 flex-1 basis-[460px] flex-col gap-9">
				<section className="flex flex-col gap-3.5">
					<h2 className={TITLE}>What it is like</h2>
					<div data-testid="prep-about" className="font-prose text-[17px] leading-relaxed text-ink">
						<MessageResponse>{prep.about}</MessageResponse>
					</div>
					{prep.sources.length > 0 && (
						<div className="flex flex-col gap-1">
							<p className="text-[15px] text-ink-2">Where {teacher} found this</p>
							<ul data-testid="prep-sources" className="flex flex-col gap-0.5">
								{prep.sources.map((s) => (
									<li key={s.url} className="min-w-0">
										<a href={s.url} target="_blank" rel="noopener noreferrer" title={s.url} className="block truncate text-[15px] text-ink underline underline-offset-4 hover:text-ink-2">
											{s.title}
										</a>
									</li>
								))}
							</ul>
						</div>
					)}
					{writing ? (
						<p data-testid="prep-rewriting" className="flex items-center gap-2.5 text-[15px] text-ink-2">
							<BrailleSpinner label="Writing the sheet again" />
							{teacher} is writing the sheet again
						</p>
					) : (
						<button type="button" data-testid="prep-rewrite" onClick={() => void run({ action: "write" })} className="lh-btn lh-btn-quiet -ml-1.5 self-start text-[15px]">
							Write the sheet again
						</button>
					)}
					{!writing && view.error && (
						<p role="alert" className="text-[15px] text-ans-wrong">
							The sheet wasn't written again: {view.error}.
						</p>
					)}
				</section>

				<section className="flex flex-col gap-2">
					<div className={cn(TITLE, "flex flex-wrap items-baseline justify-between gap-x-4")}>
						<h2>What to study</h2>
						<p className="text-[15px] text-ink-2">Weakest first. Pick one to study just that.</p>
					</div>
					<ol data-testid="prep-topics" className="flex flex-col">
						{ordered.map((t, i) => (
							<TopicRow key={t.id} n={i + 1} topic={t} busy={lesson.busy || writing} onStudy={() => void lesson.studyPrep([t.id])} onRemove={() => void run({ action: "remove-topic", topicId: t.id })} />
						))}
					</ol>
					<AddTopic disabled={writing} onAdd={(name) => act({ action: "add-topic", name })} />
					{error && (
						<p role="alert" data-testid="prep-error" className="text-[15px] text-ans-wrong">
							{error}
						</p>
					)}
				</section>
			</div>

			<Pane className="flex w-full shrink-0 flex-col gap-5 px-5 py-5 sm:sticky sm:top-6 sm:w-[292px]">
				<DayBlock date={prep.date} disabled={writing} onDate={(date) => void run({ action: "date", date })} />
				<div className="flex flex-col gap-1.5">
					<p data-testid="prep-solid" className="text-[17px] text-ink">
						{solidLine(topics)}
					</p>
					<ProgressBar share={solidShare(topics)} />
				</div>
				<div className="flex flex-col gap-2.5">
					<button type="button" data-testid="prep-study" disabled={lesson.busy || topics.length === 0} onClick={() => void lesson.studyPrep([])} className={cn("lh-btn lh-btn-main justify-center", BIG_BUTTON)}>
						<PixelIcon name="play" />
						Study
					</button>
					{lesson.error && (
						<p role="alert" className="text-[15px] text-ans-wrong">
							{lesson.error}
						</p>
					)}
				</div>
				{prep.mock && (
					<div className="flex flex-col gap-2">
						{open ? (
							<Link to={mockHref(spaceId, open.id)} data-testid="prep-open-mock" className="lh-btn justify-center text-[15px]">
								{openMockLabel(open)}
							</Link>
						) : (
							<button type="button" data-testid="prep-take-mock" disabled={mock.busy} onClick={() => void mock.take()} className="lh-btn justify-center text-[15px]">
								Take a mock
							</button>
						)}
						<p className="text-[15px] leading-snug text-ink-2">
							{formatLine(prep.mock)} {lastMockLine(view.mocks)}
						</p>
						{mock.error && (
							<p role="alert" className="text-[15px] text-ans-wrong">
								{mock.error}
							</p>
						)}
					</div>
				)}
			</Pane>
		</div>
	);
}

/** One topic: its place, name and why, how it is going, and Remove. The
 *  row itself starts a study session on just this topic. */
function TopicRow({ n, topic: t, busy, onStudy, onRemove }: { n: number; topic: PrepTopicProgress; busy: boolean; onStudy: () => void; onRemove: () => void }) {
	const boxes = meterBoxes(t.rate);
	return (
		<li data-testid={`prep-topic-${t.id}`} className="flex items-stretch border-b border-dotted border-edge last:border-b-0">
			<button type="button" data-testid="prep-topic-study" disabled={busy} onClick={onStudy} className="lh-press flex min-w-0 flex-1 items-center gap-3.5 px-1 py-3 text-left hover:bg-tone focus-visible:bg-tone">
				<span aria-hidden className="w-6 shrink-0 text-right font-count text-lg text-ink-2">
					{n}
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-lg text-ink">{t.name}</span>
					{t.why && <span className="text-[15px] leading-snug text-ink-2">{t.why}</span>}
				</span>
				<span className="w-[92px] shrink-0 text-right text-[15px] text-ink-2">{STATUS_WORD[t.status]}</span>
				<span aria-hidden className="flex shrink-0 gap-[3px]">
					{[1, 2, 3, 4, 5].map((box) => (
						<span key={box} className={cn("size-3 border-[1.5px] border-ink", box <= boxes ? "bg-ink" : "bg-background")} />
					))}
				</span>
			</button>
			<button type="button" data-testid="prep-topic-remove" aria-label={`Remove ${t.name}`} title="Remove" disabled={busy} onClick={onRemove} className="lh-press flex w-9 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink">
				<PixelIcon name="close" className="h-[9px]" />
			</button>
		</li>
	);
}

/** "Add a topic": a plain word that opens one field. */
function AddTopic({ disabled, onAdd }: { disabled: boolean; onAdd: (name: string) => Promise<string | null> }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	if (!open) {
		return (
			<button type="button" data-testid="prep-add-topic" disabled={disabled} onClick={() => setOpen(true)} className="lh-btn lh-btn-quiet -ml-1 self-start text-[15px]">
				<PixelIcon name="plus" />
				Add a topic
			</button>
		);
	}
	return (
		<form
			className="flex flex-col gap-1.5 pt-1"
			onSubmit={(e) => {
				e.preventDefault();
				if (!name.trim()) return;
				void onAdd(name).then((failed) => {
					setError(failed);
					if (!failed) {
						setName("");
						setOpen(false);
					}
				});
			}}
		>
			<div className="flex items-center gap-2">
				<input type="text" data-testid="prep-add-topic-name" aria-label="Topic to add" value={name} maxLength={TOPIC_NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} placeholder="For example Promises and async" className={FIELD} />
				<button type="submit" data-testid="prep-add-topic-save" disabled={disabled} className="lh-btn h-10 shrink-0 text-[15px]">
					Add
				</button>
				<button type="button" onClick={() => setOpen(false)} className="lh-btn lh-btn-quiet h-10 shrink-0 text-[15px]">
					Cancel
				</button>
			</div>
			{error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</form>
	);
}

/** The days left over the day itself, which the learner can change here. */
function DayBlock({ date, disabled, onDate }: { date: string | undefined; disabled: boolean; onDate: (date: string | null) => void }) {
	const nowMs = useMinute();
	const count = date && nowMs !== null ? prepCount(date, nowMs) : null;
	return (
		<div className="flex flex-col gap-2">
			<p data-testid="prep-days" className="font-count text-[34px] leading-tight text-ink">
				{!date ? "No date yet" : !count ? `was ${longDay(date)}` : count.unit ? `${count.count} ${count.unit} left` : "Today"}
			</p>
			<label className="flex flex-col gap-1.5">
				<span className="text-[15px] text-ink-2">When is it?</span>
				<span className="flex items-center gap-2">
					<input
						type="date"
						data-testid="prep-date"
						value={date ?? ""}
						disabled={disabled}
						onChange={(e) => {
							// An unfinished date (a cleared part) changes nothing.
							if (e.target.value) onDate(e.target.value);
						}}
						className={FIELD}
					/>
					{date && (
						<button type="button" data-testid="prep-date-clear" disabled={disabled} onClick={() => onDate(null)} className="lh-btn lh-btn-quiet h-10 shrink-0 text-[15px]">
							Clear
						</button>
					)}
				</span>
			</label>
		</div>
	);
}
