/** What a sidebar toggle does. While narrow the sidebar always shows as
 *  closed, so a toggle means open and asks the shell to widen the window;
 *  otherwise it flips. The caller saves `open` as the preference. */
export function toggledSidebar(open: boolean, narrow: boolean): { open: boolean; expand: boolean } {
	return narrow ? { open: true, expand: true } : { open: !open, expand: false };
}
