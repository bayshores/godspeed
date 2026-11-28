import { useEffect, useState, type ReactNode } from "react";
import { LoadingLine } from "@/frontend/components/loading";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { chip } from "@/frontend/components/ui/chip";
import { FIELD } from "@/frontend/components/ui/field";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { send, serverError } from "@/frontend/lib/api";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { cn } from "@/frontend/lib/utils";
import { ErrorLine } from "@/frontend/components/error-line";

/** GET /api/web-search: the saved key's last characters and its searches
 *  this month, as Tavily says right now. All null with no key. */
interface WebSearchView {
	keyEnd: string | null;
	used: number | null;
	limit: number | null;
	error: string | null;
}

const UNREACHABLE = "Couldn't reach godspeed. Try again.";

async function request(path: string, init?: RequestInit): Promise<WebSearchView> {
	const { error, body } = await send(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
	if (error) throw new Error(serverError(body) ?? UNREACHABLE);
	return body as WebSearchView;
}

/** "of 1,000 searches used this month", or without the limit when the plan has none. */
function usageLine(limit: number | null): string {
	return limit === null ? "searches used this month" : `of ${limit.toLocaleString("en-US")} searches used this month`;
}

/**
 * Who looks things up online for a lesson, under the Web search switch:
 * the agent's own search is used until a Tavily key is saved here; then
 * godspeed searches with that key and shows how many searches it has used.
 */
export function WebSearch() {
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const [view, setView] = useState<WebSearchView | null>(null);
	const [key, setKey] = useState("");
	const { busy, error, setError, run: guard } = useGuardedAction();
	useEffect(() => {
		request("/api/web-search").then(setView, (e: Error) => setError(e.message));
	}, [setError]);

	const run = (call: () => Promise<WebSearchView>) =>
		void guard(async () => {
			try {
				setView(await call());
				setKey("");
				return null;
			} catch (e) {
				return (e as Error).message;
			}
		});
	const hasKey = !!view?.keyEnd;
	const works = hasKey && !view.error;

	return (
		<section data-testid="web-search" aria-label="Who searches" className="flex flex-col gap-4 pt-1 pb-4">
			{!view ? (
				error ? <p className="lh-rise text-ui text-ink-2">{error}</p> : <LoadingLine className="text-ui" />
			) : (
				<div className="grid items-start gap-4 min-[860px]:grid-cols-[290px_1fr]">
					<Choice testid="web-search-agent" name={`${teacher} searches`} picked={!works}>
						<p className="text-ui text-ink-2">Free, nothing to set up. Works with Claude Code and Codex.</p>
					</Choice>
					<Choice testid="web-search-tavily" name="godspeed searches with Tavily" picked={works}>
						{hasKey ? (
							<>
								{view.used !== null && (
									<div className="flex items-center gap-4">
										<span data-testid="web-search-used" className="font-count text-[40px] leading-none text-ink">
											{view.used.toLocaleString("en-US")}
										</span>
										<div className="flex min-w-0 flex-1 flex-col gap-1.5">
											<span className="text-ui text-ink-2">{usageLine(view.limit)}</span>
											{view.limit !== null && view.limit > 0 && <ProgressBar share={view.used / view.limit} />}
										</div>
									</div>
								)}
								{view.error && (
									<p role="alert" data-testid="web-search-error" className="text-ui text-ans-wrong">
										{view.error} {teacher}'s own search is used until it works again.
									</p>
								)}
								<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
									<PixelIcon name="key" size={10} className="text-ink" />
									<span data-testid="web-search-key" className="text-ui text-ink">
										Key ending in {view.keyEnd}
									</span>
									{works && <span className={chip("right", "tag")}>Works</span>}
									<button type="button" data-testid="web-search-remove" disabled={busy} onClick={() => run(() => request("/api/web-search/key", { method: "DELETE" }))} className="lh-btn ml-auto shrink-0">
										Remove key
									</button>
								</div>
							</>
						) : (
							<form
								className="flex flex-col gap-2"
								onSubmit={(e) => {
									e.preventDefault();
									run(() => request("/api/web-search/key", { method: "PUT", body: JSON.stringify({ key }) }));
								}}
							>
								<label htmlFor="web-search-key-input" className="text-ui text-ink-2">
									Paste a Tavily key and godspeed runs the searches itself.
								</label>
								<div className="flex items-center gap-2.5">
									<input id="web-search-key-input" data-testid="web-search-key-input" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="tvly-…" className={FIELD} />
									<button type="submit" data-testid="web-search-save" disabled={busy || !key.trim()} className="lh-btn lh-btn-main shrink-0">
										Save key
									</button>
								</div>
								{busy && <p className="text-ui text-ink-2">Checking the key…</p>}
							</form>
						)}
						<ErrorLine error={error} data-testid="web-search-failed" className="text-ui text-ans-wrong" />
					</Choice>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui text-ink-2">
				<p className="mr-auto">With a key, your search words go to Tavily. godspeed still opens the pages itself.</p>
				<a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-ink">
					Get a free key at tavily.com
				</a>
			</div>
		</section>
	);
}

/** One of the two ways to search: the one in use is filled and ticked. */
function Choice({ testid, name, picked, children }: { testid: string; name: string; picked: boolean; children: ReactNode }) {
	return (
		<div data-testid={testid} data-picked={picked || undefined} className="lh-well flex min-w-0 flex-col gap-3 lh-notch p-4">
			<div className="flex items-center gap-2.5">
				<span aria-hidden className={cn("flex size-[18px] shrink-0 items-center justify-center border-2", picked ? "border-ink bg-ink text-background" : "border-edge")}>
					{picked && <PixelIcon name="check" size={10} />}
				</span>
				<h3 className={cn("lh-inner-title flex-1", picked ? "font-medium" : "text-ink-2")}>{name}</h3>
				{picked && <span className={chip("lit", "tag")}>In use</span>}
			</div>
			{children}
		</div>
	);
}
