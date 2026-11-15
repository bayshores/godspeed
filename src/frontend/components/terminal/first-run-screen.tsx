import { firstRunFooter } from "./terminal-model";
import { TerminalPane } from "./terminal-pane";
import { useTerminals } from "./use-terminals";

/** Onboarding's first start: the teacher's live screen right in the step,
 *  with its sentence and buttons under it. Nothing until it starts. It
 *  takes the keyboard only once the learner clicks in it. */
export function FirstRunScreen() {
	const api = useTerminals();
	const facts = api?.facts.teacher;
	if (!api || !facts) return null;
	return (
		<div data-testid="first-run-screen" className="lh-popup flex h-[460px] w-full flex-col overflow-hidden">
			<TerminalPane api={api} role="teacher" foot={firstRunFooter(facts, api.folder)} focusOnOpen={false} />
		</div>
	);
}
