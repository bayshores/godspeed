/** Opens a web page in the browser (the desktop app's shell, else a new tab). */
export function openOutside(url: string): void {
	if (window.lh?.openLink) void window.lh.openLink(url);
	else window.open(url, "_blank", "noopener,noreferrer");
}
