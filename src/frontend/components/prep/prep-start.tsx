import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { DEFAULT_TEACHER_NAME, GOAL_MAX } from "@/shared/core";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { useSpaces } from "@/frontend/components/space-context";
import { send } from "@/frontend/components/files/space-files-api";
import { SPACE_FILE_ACCEPT } from "@/frontend/components/files/files-model";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { isStartKey } from "@/frontend/components/home/topic-box";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { FIELD } from "@/frontend/components/ui/field";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

/**
 * "Prepare for something" ("/prep"): what the learner is preparing for, in
 * their own words, any files that say more (the job posting, the email, a
 * resume) and the day if they know it. "Write my prep sheet" makes the prep
 * and opens it; the teacher looks the thing up and writes the sheet.
 */
export function PrepStart() {
	const navigate = useNavigate();
	const { refresh, setActive } = useSpaces();
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [goal, setGoal] = useState("");
	const [date, setDate] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const goalRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const start = async () => {
		if (busy) return;
		if (!goal.trim()) return goalRef.current?.focus();
		setBusy(true);
		setError(null);
		const form = new FormData();
		form.set("goal", goal);
		if (date) form.set("date", date);
		for (const f of files) form.append("files", f);
		const { error: failed, body } = await send("/api/preps", { method: "POST", body: form });
		if (failed) {
			setBusy(false);
			return setError(failed);
		}
		// The space list first: a space it doesn't know yet can't be the active one.
		await refresh();
		setActive((body as { spaceId: string }).spaceId);
		navigate("/space");
	};

	return (
		<div className="h-full overflow-y-auto" data-testid="prep-start">
			<form
				className="lh-rise mx-auto flex w-full max-w-[768px] flex-col gap-7 px-6 pt-[22px] pb-16"
				onSubmit={(e) => {
					e.preventDefault();
					void start();
				}}
			>
				<div className="flex flex-col items-start gap-2.5">
					<Link to="/" data-testid="page-back" className="lh-btn lh-btn-quiet -ml-1 text-[15px]">
						<PixelIcon name="chevron" className="-scale-x-100" />
						Today
					</Link>
					<h1 className="text-[38px] leading-[1.2] text-ink">What are you preparing for?</h1>
				</div>

				<div className="flex flex-col rounded border-[1.5px] border-ink bg-background px-4 pt-0.5 pb-2.5">
					<textarea
						ref={goalRef}
						data-testid="prep-goal"
						aria-label="What are you preparing for?"
						value={goal}
						maxLength={GOAL_MAX}
						disabled={busy}
						onChange={(e) => setGoal(e.target.value)}
						onKeyDown={(e) => {
							if (isStartKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
								e.preventDefault();
								void start();
							}
						}}
						placeholder="An interview, an online test, an exam. Name the company and the role if you know them."
						autoFocus
						rows={2}
						className="field-sizing-content max-h-60 min-h-[86px] w-full resize-none bg-transparent pt-3 pb-3 font-prose text-[17px] leading-snug text-ink outline-none placeholder:text-ink-3"
					/>
					{files.length > 0 && (
						<ul data-testid="prep-files" className="mb-1.5 flex flex-col">
							{files.map((f, i) => (
								<li key={`${f.name}-${i}`} className="flex items-center gap-2 text-[15px] text-ink">
									<span title={f.name} className="min-w-0 truncate">
										{f.name}
									</span>
									<button type="button" disabled={busy} onClick={() => setFiles((all) => all.filter((_, at) => at !== i))} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
										Remove
									</button>
								</li>
							))}
						</ul>
					)}
					<input
						ref={fileRef}
						type="file"
						multiple
						accept={SPACE_FILE_ACCEPT}
						className="hidden"
						data-testid="prep-file-input"
						onChange={(e) => {
							const picked = Array.from(e.target.files ?? []);
							e.target.value = "";
							setFiles((all) => [...all, ...picked]);
						}}
					/>
					<button type="button" data-testid="prep-attach" disabled={busy} onClick={() => fileRef.current?.click()} className="lh-btn lh-btn-quiet -ml-1.5 self-start text-[15px] underline underline-offset-4">
						Attach the job posting, the email or your resume
					</button>
				</div>

				<div className="flex flex-col gap-1.5">
					<label htmlFor="prep-date" className={LABEL_TEXT}>
						When is it?
					</label>
					<div className="flex flex-wrap items-center gap-3">
						<input id="prep-date" type="date" data-testid="prep-date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} className={cn(FIELD, "w-[200px]")} />
						<button
							type="button"
							data-testid="prep-no-date"
							aria-pressed={date === ""}
							disabled={busy}
							onClick={() => setDate("")}
							className={cn("lh-press h-10 rounded px-3 text-[15px] text-ink", date === "" ? "bg-highlight" : "hover:bg-accent")}
						>
							No date yet
						</button>
					</div>
				</div>

				<div className="flex flex-col items-start gap-3">
					<button type="submit" data-testid="prep-write" aria-disabled={!goal.trim()} disabled={busy} className={cn("lh-btn lh-btn-main", BIG_BUTTON)}>
						<PixelIcon name="play" />
						Write my prep sheet
					</button>
					<p className="text-[15px] text-ink-2">{teacher} looks it up online, then writes what it is like and what to study. It takes a few minutes.</p>
					<NoAgentLine />
					{error && (
						<p role="alert" data-testid="prep-start-error" className="text-[15px] whitespace-pre-wrap text-ans-wrong">
							{error}
						</p>
					)}
				</div>
			</form>
		</div>
	);
}
