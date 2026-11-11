// window.lh in the desktop app: the members src/frontend/components/sidebar.tsx declares,
// calling the shell's commands. The shell fills in APP_ORIGIN and PLATFORM; every other page
// (the boot page, the login redirect) gets nothing.
(() => {
	const APP_ORIGIN = __APP_ORIGIN__;
	const PLATFORM = __PLATFORM__;
	if (location.origin !== APP_ORIGIN) return;
	const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

	// Pushes from the shell. A channel with no listener keeps its last message for the first
	// one that subscribes (a menu's open-settings arrives before React does).
	const listeners = new Map();
	const held = new Map();
	const subscribe = (channel, cb) => {
		const set = listeners.get(channel) ?? new Set();
		listeners.set(channel, set);
		set.add(cb);
		if (held.has(channel)) {
			const payload = held.get(channel);
			held.delete(channel);
			cb(payload);
		}
		return () => set.delete(cb);
	};
	window.__lhPush = (channel, payload) => {
		if (channel === "zoom") {
			try {
				localStorage.setItem("lh-zoom", String(payload));
			} catch {
				// storage blocked: the factor is simply not restored next time
			}
		}
		const set = listeners.get(channel);
		if (set?.size) for (const cb of set) cb(payload);
		else held.set(channel, payload);
	};

	// Restore the last zoom before the page draws.
	try {
		const saved = Number(localStorage.getItem("lh-zoom"));
		if (saved) void invoke("set_zoom", { factor: saved });
	} catch {
		// storage blocked: start at 100%
	}

	// The zoom keys the menu does not claim (other layouts, ⌘+); menu keys never reach the page.
	window.addEventListener("keydown", (e) => {
		if (!(e.metaKey || e.ctrlKey)) return;
		if (e.key === "=" || e.key === "+") void invoke("zoom_step", { dir: 1 });
		else if (e.key === "-") void invoke("zoom_step", { dir: -1 });
		else if (e.key === "0") void invoke("zoom_reset");
		else return;
		e.preventDefault();
	});

	// The app's own menus handle the event earlier; nothing else shows the browser's.
	window.addEventListener("contextmenu", (e) => e.preventDefault());

	if (PLATFORM === "darwin") {
		// Chromium's -webkit-app-region rule: the last listed element under the point decides.
		const NO_DRAG = ".lh-no-drag, .lh-drag :is(button, input, textarea, select, a, summary, [contenteditable])";
		const dragsAt = (x, y) => {
			if (!document.documentElement.matches('html.lh-desktop[data-lh-platform="darwin"]')) return false;
			let drag = false;
			for (const el of document.querySelectorAll(`.lh-drag, ${NO_DRAG}`)) {
				const r = el.getBoundingClientRect();
				if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) drag = !el.matches(NO_DRAG);
			}
			return drag;
		};
		const plain = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
		window.addEventListener("mousedown", (e) => {
			if (!plain(e) || !dragsAt(e.clientX, e.clientY)) return;
			e.preventDefault();
			void invoke("start_drag");
		});
		window.addEventListener("dblclick", (e) => {
			if (plain(e) && dragsAt(e.clientX, e.clientY)) void invoke("title_bar_double_click");
		});
	} else {
		// A lone Alt press and release shows or hides the menu bar.
		let altAlone = false;
		window.addEventListener("keydown", (e) => {
			if (e.key !== "Alt") altAlone = false;
			else if (!e.repeat) altAlone = true;
		});
		window.addEventListener("keyup", (e) => {
			if (e.key === "Alt" && altAlone) void invoke("toggle_menu");
			altAlone = false;
		});
	}

	window.lh = {
		platform: PLATFORM,
		showWindow: () => void invoke("show_window"),
		expandWindow: () => void invoke("expand_window"),
		onZoom: (cb) => subscribe("zoom", cb),
		getZoom: () => invoke("get_zoom"),

		// OS commands: folders, files, fonts, printing, updates and bug reports.
	};
})();
