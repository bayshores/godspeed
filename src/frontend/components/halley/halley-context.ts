"use client";

/** The teacher's state, as the provider (halley-provider.tsx) shares it. In
 *  its own file so parts the provider draws can read it without an import
 *  cycle. */
import { createContext, useContext } from "react";
import type { AgentAction } from "@/shared/core";
import type { AgentDoing } from "./follow-status";

export interface LessonPresence {
	/** A teacher message is being written. */
	streaming: boolean;
	/** A turn is in flight. */
	working: boolean;
	/** The learner has unsent text here: Follow stays on this lesson. */
	draft: boolean;
}

export interface HalleyApi {
	name: string;
	follow: boolean;
	setFollow: (on: boolean) => void;
	panelOpen: boolean;
	setPanelOpen: (open: boolean) => void;
	/** Newest first. */
	recent: AgentAction[];
	/** What the agent is doing now; null while no agent is connected. */
	doing: AgentDoing | null;
	/** A lesson screen reports itself (null when it leaves). */
	setLesson: (p: LessonPresence | null) => void;
	/** Go to a change (a Recent row): its page, then fly to it. */
	go: (action: AgentAction) => void;
	/** With Follow off: a fresh change on another page, to offer "Go to". */
	offer: AgentAction | null;
	/** A class's name by id (Recent rows name the class). */
	classNameOf: (id: string | null) => string | null;
}

export const HalleyContext = createContext<HalleyApi | null>(null);

/** The teacher's state; null outside the app shell (render tests, onboarding). */
export function useHalley(): HalleyApi | null {
	return useContext(HalleyContext);
}
