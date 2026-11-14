import { useEffect } from "react";
import { firstRunFooter } from "./terminal-model";
import { TerminalPane } from "./terminal-pane";
import { useTerminals } from "./use-terminals";

/** Onboarding's first start: the teacher's live screen right in the step,
 *  with its sentence and buttons under it. Nothing until it starts. */
export function FirstRunScreen() {
	const api = useTerminals();
	const id = api?.teacher?.id;
	const show = api?.show;
	const hide = api?.hide;
	// This screen stands in for the overlay: what shows here counts as seen.
	useEffect(() => {
		if (!id || !show || !hide) return;
		show("teacher");
		return hide;
	}, [id, show, hide]);
	const facts = api?.facts.teacher;
	if (!api || !facts) return null;
	return (
		<div data-testid="first-run-screen" className="flex h-[460px] w-full flex-col overflow-hidden rounded border-2 border-line bg-panel">
			<TerminalPane api={api} role="teacher" foot={firstRunFooter(facts, api.folder)} />
		</div>
	);
}
