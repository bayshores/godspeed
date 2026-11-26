/**
 * How many turns run now, in lessons and the teacher panel's chats alike: one read of GET
 * /api/turns for the window, again as a turn starts and settles and after a reconnect. Restart
 * asks first while one runs, and Follow says "Working" for a lesson's turn on another page.
 */

import { createContext, useContext } from "react";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** null until read (or outside the provider). */
export const TurnsRunningContext = createContext<number | null>(null);

export function TurnsRunningProvider({ children }: { children: React.ReactNode }) {
	// A failed read keeps the last count.
	const { value } = useServerResource<{ running: number }>("/api/turns", { on: { "turn-started": true, "turn-settled": true } });
	return <TurnsRunningContext.Provider value={value?.running ?? null}>{children}</TurnsRunningContext.Provider>;
}

export function useTurnsRunning(): number | null {
	return useContext(TurnsRunningContext);
}
