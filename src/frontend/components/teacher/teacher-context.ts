/** The teacher's state, as the provider (teacher-provider.tsx) shares it. In
 *  its own file so parts the provider draws can read it without an import
 *  cycle. */
import { createContext, useContext } from "react";
import type { AgentAction } from "@/shared/core";
import type { TerminalRole } from "@/frontend/components/terminal/terminal-model";
import type { AgentDoing } from "./follow-status";

export interface LessonPresence {
	/** A teacher message is being written. */
	streaming: boolean;
	/** A turn is in flight. */
	working: boolean;
	/** The learner has unsent text here: Follow stays on this lesson. */
	draft: boolean;
}

export interface TeacherApi {
	name: string;
	follow: boolean;
	setFollow: (on: boolean) => void;
	panelOpen: boolean;
	/** The open panel shows a key that starts the teacher (panelStarts). */
	panelStarts: boolean;
	setPanelOpen: (open: boolean) => void;
	/** Open the panel on the agent's screen, that one (the teacher's
	 *  when none is named; background work's shows as its own view with
	 *  Back), which takes the keyboard. */
	showTerminal: (role?: TerminalRole) => void;
	/** The teacher can be handed a line by a page key (ask): godspeed runs it in its own
	 *  terminal here, so not in a browser, with an outside agent or popped out. */
	canAsk: boolean;
	/** A page key hands the teacher one line: the panel opens on its screen and sends it once the
	 *  teacher can take it. A second line replaces one not yet sent. */
	ask: (line: string) => void;
	/** The line waiting to be sent (ask), which the panel's screen takes; `clear` once it has. */
	asking: { line: string; clear: () => void } | null;
	/** Newest first. */
	recent: AgentAction[];
	/** What the agent is doing now; null while no agent is connected. */
	doing: AgentDoing | null;
	/** A lesson screen reports itself (null when it leaves). */
	setLesson: (p: LessonPresence | null) => void;
	/** Go to a change (a Recent row): its page, then fly to it. */
	go: (action: AgentAction) => void;
	/** What "Go to" offers: a page the agent opened while the window held,
	 *  else with Follow off a fresh change on another page. */
	offer: AgentAction | null;
	/** The offer is a held open, shown with Follow on too. */
	held: boolean;
	/** A space's name by id (Recent rows name the space). */
	spaceNameOf: (id: string | null) => string | null;
}

export const TeacherContext = createContext<TeacherApi | null>(null);

/** The teacher's state; null outside the app shell (render tests, onboarding). */
export function useTeacher(): TeacherApi | null {
	return useContext(TeacherContext);
}
