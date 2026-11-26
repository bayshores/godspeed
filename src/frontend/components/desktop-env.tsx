import { useEffect } from "react";
import type { UpdateState } from "@/frontend/components/settings/update-settings.tsx";
import { useZoom } from "@/frontend/components/use-zoom";

declare global {
	interface Window {
		/** The desktop shell's bridge (crates/shell/src/shim.js), absent in a plain browser. */
		lh?: {
			/** Read-only host OS; determines the native-control gutter. */
			platform?: string;
			/** Native folder picker: absolute path or null. */
			pickFolder?: () => Promise<string | null>;
			/** Opens Finder (File Explorer) with this file selected. */
			showInFolder?: (path: string) => Promise<void>;
			/** Opens this folder in Finder (File Explorer), or this PDF in its default app. */
			openPath?: (path: string) => Promise<void>;
			/** Opens this note in Obsidian; the shell builds the obsidian:// link itself. */
			openInObsidian?: (path: string) => Promise<void>;
			/** The teacher panel's chat in a window of its own, beside the main window. */
			chatWindow?: {
				/** Opens the window, or brings it forward when it is open; the main window only. `title` is the teacher's name. */
				open: (title: string) => Promise<void>;
				/** Closes the window; either window may. Closing one that isn't there does nothing. */
				close: () => Promise<void>;
				/** Brings the window to the front, out of the Dock if minimized; rejects when it isn't open. */
				focus: () => Promise<void>;
				/** The main page hears whether the window is open when it opens or closes, and after every load of the main page. `back`: a page asked to put the chat back, so the main page shows it. */
				onChange: (cb: (state: { open: boolean; back?: boolean }) => void) => () => void;
			};
			/** Opens an http, https or mailto link in the browser. */
			openLink?: (url: string) => Promise<void>;
			/** A dropped file's or folder's absolute path, or "" where the OS gives none (onboarding drop zone). */
			pathForFile?: (file: File) => Promise<string>;
			/** The first screen is drawn: show the window (hidden until then). */
			showWindow?: () => void;
			/** The zoom truth: subscribes to "lh:zoom" pushes; returns unsubscribe. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Sets the zoom to one of the shell's ladder values. */
			setZoom?: (factor: number) => Promise<void>;
			/** Observational update events and a snapshot for late subscribers. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** Explicit manual check also downloads and stages available updates. */
			checkForUpdates?: () => Promise<void>;
			installUpdate?: () => void;
			/** Opens a new GitHub issue with the app version and OS filled in. */
			reportBug?: () => void;
			/** The installed font families, sorted. */
			listFonts?: () => Promise<string[]>;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
			/** A Mac File or Go menu item: a keyboard action id, `go:<path>`, `back` or `forward`. */
			onMenu?: (cb: (action: string) => void) => () => void;
			/** Opens the system print sheet for a PDF in the data folder. Mac only. */
			printPdf?: (path: string) => Promise<void>;
			/** Puts the app icon saved in Settings on the Dock and on the app itself. Mac only. */
			applyAppIcon?: () => Promise<void>;
		};
	}
}

/**
 * What the page does only inside the desktop shell: mark the document
 * (.lh-desktop in globals.css makes room for the traffic lights), and
 * publish the zoom factor so the gutters beside the native window buttons
 * keep their size at every zoom. The shell's shim defines window.lh before
 * the page's scripts run, so a plain browser never gets the class.
 */
export function DesktopEnv() {
	useEffect(() => {
		if (window.lh) {
			document.documentElement.classList.add("lh-desktop");
			document.documentElement.dataset.lhPlatform = window.lh.platform ?? "";
		}
	}, []);
	const zoom = useZoom();
	useEffect(() => {
		document.documentElement.style.setProperty("--lh-zoom", String(zoom));
	}, [zoom]);
	return null;
}
