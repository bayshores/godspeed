import { createContext, useContext } from "react";

/** Whether the sidebar shows, for the parts of the app outside it. */
export const SidebarContext = createContext<{ open: boolean; toggle: () => void; fold: (on: boolean) => void }>({
	open: false,
	toggle: () => {},
	fold: () => {},
});

export function useSidebar() {
	return useContext(SidebarContext);
}
