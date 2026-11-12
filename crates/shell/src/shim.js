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
	// Windows: the path a dropped file's message was sent for.
	const drops = new Map();
	let lastDrop = 0;
	window.__lhPush = (channel, payload) => {
		if (channel === "drop-path") {
			drops.get(payload.n)?.(payload.path);
			return;
		}
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

	// The window never sends a navigation to the browser (it cannot tell this page from a demo
	// iframe), so a click on a web or mail link goes out here.
	window.addEventListener("click", (e) => {
		const link = !e.defaultPrevented && e.target instanceof Element ? e.target.closest("a[href]") : null;
		if (!link) return;
		let url;
		try {
			url = new URL(link.getAttribute("href"), location.href);
		} catch {
			return;
		}
		if (url.origin === APP_ORIGIN || !["http:", "https:", "mailto:"].includes(url.protocol)) return;
		e.preventDefault();
		void invoke("open_link", { url: url.href });
	});

	// The app's own menus handle the event earlier; nothing else shows the browser's.
	window.addEventListener("contextmenu", (e) => e.preventDefault());

	// A dropped file's path on disk (onboarding links a dropped folder). WebKit gives the page
	// none, so each platform has its own way; Linux has none.
	let pathForFile = () => Promise.resolve("");

	if (PLATFORM === "darwin") {
		// The drag pasteboard keeps the dropped files after the drop, so the shell reads it then; a
		// drag released anywhere else leaves nothing behind for the next drop. A file is matched by
		// its name.
		let dropPaths = Promise.resolve([]);
		window.addEventListener(
			"drop",
			() => {
				dropPaths = invoke("drag_paths").catch(() => []);
			},
			true,
		);
		const lastSegment = (path) => path.split("/").pop().normalize("NFC");
		pathForFile = async (file) => (await dropPaths).find((path) => lastSegment(path) === file.name.normalize("NFC")) ?? "";

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
		// The second press of a double click starts no drag: the drag would track the mouse until
		// it is released, and WebKit would never see that mouse-up, or send its dblclick. A
		// release where it was pressed is the double click, as the system title bar has it.
		let secondPress = null;
		window.addEventListener("mousedown", (e) => {
			secondPress = null;
			if (!plain(e) || !dragsAt(e.clientX, e.clientY)) return;
			e.preventDefault();
			if (e.detail === 2) secondPress = { x: e.clientX, y: e.clientY };
			else void invoke("start_drag");
		});
		window.addEventListener("mouseup", (e) => {
			const press = secondPress;
			secondPress = null;
			if (press && e.detail === 2 && e.clientX === press.x && e.clientY === press.y) void invoke("title_bar_double_click");
		});
	} else {
		if (PLATFORM === "win32") {
			// The file goes to the shell in a message that its Windows hook answers with a push. A
			// string message: WebView2 stops at wry's own handler for any other kind, and Tauri only
			// logs a body it cannot read.
			pathForFile = (file) =>
				new Promise((resolve) => {
					const n = ++lastDrop;
					const done = (path) => {
						clearTimeout(timer);
						drops.delete(n);
						resolve(path);
					};
					const timer = setTimeout(() => done(""), 2000);
					drops.set(n, done);
					try {
						window.chrome.webview.postMessageWithAdditionalObjects(JSON.stringify({ lhDrop: n }), [file]);
					} catch {
						done("");
					}
				});
		}
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
		pickFolder: () => invoke("pick_folder"),
		showInFolder: (path) => invoke("show_in_folder", { path }),
		openPath: (path) => invoke("open_path", { path }),
		openAgent: (folder, agent) => invoke("open_agent", { folder, agent }),
		pathForFile,
		reportBug: () => void invoke("report_bug"),
		listFonts: () => invoke("list_fonts"),
		onUpdateStatus: (cb) => subscribe("update", cb),
		getUpdateState: () => invoke("update_state"),
		checkForUpdates: () => invoke("update_check"),
		installUpdate: () => void invoke("update_install"),
		onOpenSettings: (cb) => subscribe("open-settings", cb),
	};
	// Only the Mac prints through the system's own sheet.
	if (PLATFORM === "darwin") window.lh.printPdf = (path) => invoke("print_pdf", { path });
})();
