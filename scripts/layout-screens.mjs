import { WAITING_TOPIC } from "./layout-seed.mjs";

/**
 * layout-screens.mjs — the screens `npm run layout` checks, in order, each at every width.
 *
 * A screen opens at `url`, waits for `ready`, runs `setup` in the page (clicks), then waits for
 * `shows`. `ready` and `shows` name something drawn from the screen's data, not its frame, so the
 * check never runs on a screen still loading. `height` gives it a window higher than the
 * check's own. `before` runs in the page first, on the screen
 * before it, for a change of data; it stays for the screens after it. `{space}`, `{lesson}`,
 * `{deadline}`, `{homeworkOpen}`, `{homeworkFirst}`, `{homeworkMany}`, `{homeworkPrinted}`, `{homeworkOpenDeadline}`, `{longProblem}`, `{problemFirst}`, `{twoSheets}`, `{askedFirst}`, `{codeChoices}`, `{pending}`, `{sheetless}`, `{pathSpace}`, the cheat sheet deadlines `{sheetMade}`, `{sheetVersions}` and `{waitingDeadline}`, the mock deadline `{mockRunDeadline}` and the mocks `{mockGraded}`, `{mockReady}`, `{mockRunning}` and `{mockPaused}` are the made-up data's ids (layout-seed.mjs). Scripts may await.
 */

export const WIDTHS = [1440, 1100, 800];
/** A window high enough for "Your turn" pinned under the lesson text (`height` on a screen). A screen too
 *  low for it, as GitHub's Mac runner has, leaves that screen unchecked with a warning. */
const TALL = 860;

/** After a fetch in the page: an HTTP error throws, so a setup that failed is not walked past. */
export const HTTP_OK = `.then((r) => { if (!r.ok) throw new Error(r.url + " answered " + r.status); return r; })`;

const pause = `await new Promise((done) => setTimeout(done, 100))`;
/** Waits in the page, up to 10 s, for something a click before it brings. */
const whenThere = (selector) => `for (let n = 0; n < 100 && !document.querySelector("${selector}"); n++) ${pause}`;
const openTeacher = `document.querySelector("[data-testid=strip]").click()`;
/** The pointer comes to rest on the strip, so its peek slides out. */
const peekOut = `document.querySelector("[data-strip]").dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }))`;
const peekShown = "[data-testid=peek][data-state=open] [data-testid=peek-status]";
const deadlineCard = "[data-teacher-target='deadline:{deadline}']";
/** Home's every part at once, from both spaces so the blocks' colors differ: five deadlines on one
 *  day (so it folds to three and "+2 more"), one late, one ticked done today, more across the week,
 *  two later. Dates count from the day the check runs. */
const busyDay = `const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv");
const base = (space) => "/api/spaces/" + space + "/deadlines";
const add = (space, kind, name, n, time) => fetch(base(space), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, date: day(n), time, fileIds: [] }) })${HTTP_OK};
await add("{space}", "homework", "Slope drills", -2);
await add("{space}", "exam", "Graphing quiz", 3, "10:00");
await add("{pathSpace}", "project", "REST API with tests", 3);
await add("{space}", "homework", "Reading, chapter 4", 3, "12:00");
await add("{pathSpace}", "interview", "Phone screen with Acme", 3, "15:00");
await add("{pathSpace}", "homework", "SQL joins practice", 3, "08:00");
await add("{space}", "homework", "Lab write-up", 5);
await add("{pathSpace}", "homework", "Git branching exercises", 0, "23:00");
await add("{pathSpace}", "interview", "Mock system design interview", 1, "18:00");
await add("{space}", "exam", "Final exam, everything", 20, "09:00");
await add("{pathSpace}", "project", "Portfolio site", 12);
const { deadlines } = await fetch("/api/deadlines")${HTTP_OK}.then((r) => r.json());
const done = deadlines.find((d) => d.name === "Git branching exercises");
await fetch(base("{pathSpace}") + "/" + done.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) })${HTTP_OK};`;

/** A task due yesterday in the other space, so the top bar asks about it on every page but Home. */
const lateHomework = `const day = new Date(Date.now() - 86400000).toLocaleDateString("sv");
await fetch("/api/spaces/{pathSpace}/deadlines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "homework", name: "Cover letter draft", date: day, fileIds: [] }) })${HTTP_OK};`;
/** Takes that homework away again, so the screens after it are as before. */
const dropLateHomework = `const { deadlines } = await fetch("/api/deadlines")${HTTP_OK}.then((r) => r.json());
const late = deadlines.find((d) => d.name === "Cover letter draft");
if (late) await fetch("/api/spaces/{pathSpace}/deadlines/" + late.id, { method: "DELETE" })${HTTP_OK};`;

/** A space with nothing in it, made and opened. It stays, so its screen is the last before Onboarding. */
const newSpace = `const made = await fetch("/api/spaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Backend development", description: "Become a backend developer" }) })${HTTP_OK}.then((r) => r.json());
const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json());
await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, activeSpace: made.space.id }) })${HTTP_OK};`;
/** A lesson in that space, which is still the open one. */
const lessonInNewSpace = `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json());
await fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "HTTP basics", spaceId: settings.general.activeSpace }) })${HTTP_OK};`;
/** The homework with a problem open covers the made-up file, as the exam does not, so it can be Progress's next deadline. */
const homeworkCoversFile = `const { space } = await fetch("/api/spaces/{space}")${HTTP_OK}.then((r) => r.json());
await fetch("/api/spaces/{space}/deadlines/{homeworkOpenDeadline}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileIds: [space.files[0].id] }) })${HTTP_OK};`;
/** The homework comes before the quiz, so it is Progress's next deadline. */
const homeworkTomorrow = `const day = new Date(Date.now() + 86_400_000);
const date = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
await fetch("/api/spaces/{space}/deadlines/{homeworkOpenDeadline}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ date }) })${HTTP_OK};`;
/** Two Study lessons on the exam, so its page lists them. */
const twoLessons = `for (let n = 0; n < 2; n++) await fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "{space}", deadlineId: "{deadline}" }) })${HTTP_OK};`;
const dropTwoLessons = `const { chats } = await fetch("/api/chats?space={space}")${HTTP_OK}.then((r) => r.json());
for (const c of chats.filter((c) => c.deadlineId === "{deadline}" && c.kind === "study")) await fetch("/api/chats/" + c.id + "?mode=preserve-graph", { method: "DELETE" })${HTTP_OK};`;
/** Every deadline the seed made, so Home has none. */
const dropDeadlines = ["{deadline}", "{homeworkOpenDeadline}", "{homeworkFirstDeadline}", "{homeworkManyDeadline}", "{homeworkPrintedDeadline}", "{sheetMade}", "{sheetVersions}", "{mockRunDeadline}", "{waitingDeadline}"].map((id) => `await fetch("/api/spaces/{space}/deadlines/${id}", { method: "DELETE" })${HTTP_OK};`).join("\n");

/** A folder that is always there and always empty, linked to the second space. */
const linkedFolder = `await fetch("/api/spaces/{pathSpace}/folder", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/private/var/empty" }) })${HTTP_OK};`;
/** The second space closed, so the plus list has a closed space; the first is the open one again. */
const closedSpace = `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json());
await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, activeSpace: "{space}" }) })${HTTP_OK};
await fetch("/api/spaces/{pathSpace}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ closed: true }) })${HTTP_OK};`;

/** A file added to the space with no agent to read it, so the strip says that work waits. It
 *  can't be removed while it waits, so the stand-in agent started later takes it. */
const waitingFile = `const form = new FormData();
form.append("files", new File(["# Slopes\\n\\nRise over run."], "waiting-notes.md", { type: "text/markdown" }));
await fetch("/api/spaces/{space}/files", { method: "POST", body: form })${HTTP_OK};`;
/** The deadline asks for a study guide with no agent to make it. The deadline is deleted for
 *  "Home with no deadline", which ends the request. */
const waitingRequest = `await fetch("/api/spaces/{space}/deadlines/{deadline}/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "guide" }) })${HTTP_OK};`;

/** The lesson made and never sent: opened at this address, the window sends its first message once,
 *  as Study does, and with no agent connected its reply waits. */
const waitingLesson = `/chat/{pending}?prompt=${encodeURIComponent(WAITING_TOPIC)}`;
/** The desk at the foot of that lesson, still while no agent takes the reply, at work once one does. */
/** A lesson turn running: Stop at the lesson's foot. */
const turnRuns = "[data-testid=stop-turn]";
/** That lesson's reply stopped (a screen before may have stopped it already) and the lesson deleted, so the screens after it are as before. A
 *  lesson can't be deleted while its turn runs, so the delete is tried until the stop has ended it. */
const dropWaitingLesson = `await fetch("/api/activity/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "turn", id: "{pending}" }) });
for (let tries = 0; ; tries++) {
	const res = await fetch("/api/chats/{pending}?mode=preserve-graph", { method: "DELETE" });
	if (res.ok) break;
	if (tries > 50) throw new Error("the waiting lesson was never deleted: " + res.status);
	await new Promise((done) => setTimeout(done, 100));
}`;

/** Find opened in the top bar by its magnifying glass `key`, with `word` typed into its `field`. */
const findWord = (key, field, word) => `document.querySelector("[data-testid=${key}]").click(); ${pause};
const box = document.querySelector("[data-testid=${field}] input");
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, ${JSON.stringify(word)});
box.dispatchEvent(new Event("input", { bubbles: true })); ${pause}`;

/** The Graph page fits the window: neither the page nor its frame scrolls. */
const fitsWindow = `${pause}; const frame = document.querySelector("[data-testid=graph-page]").firstElementChild;
if (document.scrollingElement.scrollHeight > innerHeight + 1 || frame.scrollHeight > frame.clientHeight + 1) throw new Error("the Graph page scrolls")`;

/** Unfolds a lesson's steps for this screen only; the lessons after it open folded. */
const unfoldSteps = `document.querySelector("[data-testid=plan-fold]").click(); localStorage.removeItem("lh:steps-open")`;

/** A click on the first topic with facts in the Graph's picture. */
const pickTopic = `[...document.querySelectorAll("[data-testid=graph-topic]")].find((topic) => !/\\b0 facts/.test(topic.getAttribute("aria-label"))).click()`;

/** Waits for the Graph's camera to come to rest: a flight takes 0.3 s, so its zoom reads the same on two looks apart. `arrived` is the page expression that says the camera went where the screen asked; a narrow window shows the panel in the picture's place, and then there is nothing to wait for. */
const cameraRests = (arrived) => `{ const picture = () => document.querySelector("[data-testid=graph-picture]");
let last;
for (let i = 0; picture(); i++) {
	await new Promise((done) => setTimeout(done, 150));
	const zoom = picture()?.getAttribute("data-zoom");
	if (!picture() || (${arrived} && zoom === last)) break;
	if (i > 30) throw new Error("the Graph's camera never came to rest");
	last = zoom;
} }`;
/** The picture is zoomed in by hand, as far as the wheel goes: one wheel event a third of the way in. */
const wheelIn = `{ const picture = document.querySelector("[data-testid=graph-picture]"); const at = picture.getBoundingClientRect();
picture.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1500, clientX: at.left + at.width / 3, clientY: at.top + at.height / 3 })); }`;

/** Four more open spaces, so with the first one the bar has five tabs; their names hang below the line too. */
const moreSpaces = ["Spanish grammar, preterite", "Physics: waves and optics", "Typing practice", "Japanese reading"]
	.map((name) => `await fetch("/api/spaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: ${JSON.stringify(name)} }) })${HTTP_OK};`)
	.join("\n");
/** The first lesson's title at 40 letters, the longest the bar's crumb is checked with. */
const LONG_TITLE = "Graphing linear equations, by hand, fast";
const longTitle = `await fetch("/api/chats/{lesson}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: ${JSON.stringify(LONG_TITLE)} }) })${HTTP_OK};`;
/** The written-answer lesson moved out of its space, so the bar lights the + with the lesson's title after it. */
const noSpace = `await fetch("/api/chats/{written}/space", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "none" }) })${HTTP_OK};`;

/** A deadline with nothing made asks for its cheat sheet and for a mock, with no agent to answer. */
const askSheet = `await fetch("/api/spaces/{space}/deadlines/{waitingDeadline}/cheat-sheet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ask", text: "Make my cheat sheet for the spring exam." }) })${HTTP_OK};`;
const askMock = `await fetch("/api/spaces/{space}/mocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deadlineId: "{waitingDeadline}", questions: 5, minutes: 60 }) })${HTTP_OK};`;
/** Both requests ended, so no agent that starts later takes them and the screens after are as before. */
const dropAskedRequests = `await fetch("/api/spaces/{space}/deadlines/{waitingDeadline}/cheat-sheet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) })${HTTP_OK};
const { mocks } = await fetch("/api/spaces/{space}/mocks?deadline={waitingDeadline}")${HTTP_OK}.then((r) => r.json());
for (const mock of mocks) await fetch("/api/spaces/{space}/mocks/" + mock.id, { method: "DELETE" })${HTTP_OK};`;
/** The cheat sheet page's pages drawn: pdf.js paints each into a canvas a moment after the page opens. */
const sheetDrawn = (page) => `[data-testid=cheat-sheet-page]:nth-child(${page}) canvas`;
const sheetPage = (deadline) => `/space/deadline/${deadline}/cheat-sheet`;
const mockPage = (mock) => `/space/mock/{space}/${mock}`;

export const SCREENS = [
	{ name: "Home with a deadline", url: "/", ready: deadlineCard },
	{ name: "Home, the Add deadline menu", url: "/", ready: "[data-testid=home-add-deadline][aria-haspopup=menu]", setup: `document.querySelector("[data-testid=home-add-deadline]").click()`, shows: "[data-testid=home-add-deadline-menu][data-state=open]" },
	{ name: "Home, the Menu list", url: "/", ready: deadlineCard, setup: `document.querySelector("[data-testid=app-menu]").click()`, shows: "[data-testid=app-menu-list][data-state=open]" },
	{ name: "Home, the keyboard shortcuts list", url: "/", ready: deadlineCard, setup: `document.querySelector("[data-testid=app-menu]").click(); ${pause}; document.querySelector("[data-testid=menu-shortcuts]").click()`, shows: "[data-testid=shortcuts][data-state=open]" },
	{ name: "Home, the plus list", url: "/", ready: deadlineCard, setup: `document.querySelector("[data-testid=spaces-plus]").click()`, shows: "[data-testid=spaces-plus-list][data-state=open]" },
	{ name: "Progress", url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]" },
	{ name: "Progress, Edit space", url: "/space", ready: "[data-testid=space-edit]", setup: `document.querySelector("[data-testid=space-edit]").click()`, shows: "[data-testid=space-dialog][data-state=open] [data-testid=space-close]" },
	{ name: "Progress, the strip's peek", url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]", setup: peekOut, shows: peekShown },
	{ name: "Progress, every unfinished lesson shown", url: "/space", ready: "[data-testid=unfinished-show-all]", setup: `document.querySelector("[data-testid=unfinished-show-all]").click()`, shows: "[data-testid=unfinished-lessons] li:nth-child(5)" },
	{ name: "Progress, a lesson's menu", url: "/space", ready: "[data-testid=lesson-row-menu]", setup: `document.querySelector("[data-testid=lesson-row-menu]").click()`, shows: "[data-testid=lesson-menu][data-state=open]" },
	{ name: "Study", url: "/new", ready: "[data-testid=home-deadlines] [data-testid=home-study-deadline]", shows: "[data-testid=home-suggestions]" },
	{ name: "Files", url: "/space/files", ready: "[data-testid=files-list] > *" },
	{ name: "Files, Find open", url: "/space/files", ready: "[data-testid=files-find]", setup: findWord("files-find", "files-search", "notes"), shows: "[data-testid=files-search]" },
	// The app's own terminal runs here, so the page can hand the teacher a line: the key shows beside the sentence.
	{ name: "Files, nothing found", url: "/space/files", ready: "[data-testid=files-find]", setup: findWord("files-find", "files-search", "zzzqx"), shows: "[data-testid=files-ask-inside]" },
	{ name: "Files, a file's menu", url: "/space/files", ready: "[data-testid=files-list] button[aria-label^='More for']", setup: `document.querySelector("[data-testid=files-list] button[aria-label^='More for']").click()`, shows: "[data-testid^=space-file-menu-body-][data-state=open]" },
	// The worksheet and its .tex are one row; its menu and Remove act on both.
	{
		name: "Files, a .tex and its PDF's menu",
		url: "/space/files",
		ready: "[data-testid=files-list] [data-testid^=space-file-source-]",
		setup: `document.querySelector("[data-testid^=space-file-source-]").closest("li").querySelector("button[aria-label^='More for']").click()`,
		shows: "[data-testid^=space-file-menu-body-][data-state=open]",
	},
	{
		name: "Files, removing a .tex and its PDF asks first",
		url: "/space/files",
		ready: "[data-testid=files-list] [data-testid^=space-file-source-]",
		setup: `document.querySelector("[data-testid^=space-file-source-]").closest("li").querySelector("button[aria-label^='More for']").click(); ${pause}; document.querySelector("[data-testid^=space-file-remove-]").click()`,
		shows: "[data-testid=files-confirm]",
	},
	// Picking files to study. The homework assignments (the made-up notes and the worksheet) carry problem lists, drawn as blocks after their names.
	{ name: "Files, a file's problems as blocks", url: "/space/files", ready: "[data-testid=files-list] [data-testid^=space-file-blocks-]" },
	{
		name: "Files, two files picked",
		url: "/space/files",
		ready: "[data-testid=files-list] [data-testid^=space-file-pick-]",
		setup: `const rows = document.querySelectorAll("[data-testid=files-list] [data-testid^=space-file-pick-]"); rows[0].click(); ${pause}; rows[1].click()`,
		shows: "[data-testid=files-picked-bar][data-state=open] [data-testid=files-picked-study]",
	},
	{
		name: "Files, picking files",
		url: "/space/files",
		ready: "[data-testid=files-head] [data-testid=files-pick]",
		setup: `document.querySelector("[data-testid=files-pick]").click()`,
		shows: "[data-testid=files-picked-bar][data-state=open] [data-testid=files-picked-clear]",
	},
	{ name: "Graph", url: "/graph", ready: "[data-testid=graph-picture] [data-testid=graph-topic]", setup: fitsWindow },
	{ name: "Graph, finding a word", url: "/graph", ready: "[data-testid=graph-find]", setup: findWord("graph-find", "graph-find-field", "undo"), shows: "[data-testid=graph-find-field]" },
	{ name: "Graph, Find open", url: "/graph", ready: "[data-testid=graph-find]", setup: `document.querySelector("[data-testid=graph-find]").click(); ${pause}`, shows: "[data-testid=graph-find-field]" },
	{ name: "Graph, finding a word nothing matches", url: "/graph", ready: "[data-testid=graph-find]", setup: findWord("graph-find", "graph-find-field", "zzzz"), shows: "[data-testid=graph-no-match]" },
	{
		name: "Graph, a topic picked",
		url: "/graph",
		ready: "[data-testid=graph-topic]",
		setup: `${pickTopic}; ${cameraRests(`picture().hasAttribute("data-near") && document.querySelector("[data-figure]")`)}; ${fitsWindow}`,
		shows: "[data-testid=graph-panel] [data-testid=topic-pane]",
	},
	{
		name: "Graph, zoomed by hand",
		url: "/graph",
		ready: "[data-testid=graph-picture] [data-testid=graph-topic]",
		setup: `${wheelIn}; ${cameraRests(`zoom !== null`)}; ${fitsWindow}`,
		shows: "[data-testid=graph-whole-space]",
	},
	{
		name: "Graph, a fact picked",
		url: "/graph",
		ready: "[data-testid=graph-topic]",
		setup: `${pickTopic}; ${pause}; document.querySelector("[data-testid=topic-pane] [data-testid=fact-row]").click()`,
		shows: "[data-testid=graph-panel] [data-testid=fact-pane]",
	},
	{
		name: "Graph beside the teacher's panel, whose Activity ends with the graph's costs",
		url: "/graph",
		ready: "[data-testid=graph-picture] [data-testid=graph-topic]",
		// The page is narrowest here: the panel takes its room.
		setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=teacher-panel-activity]").click()`,
		shows: "[data-testid=activity-list] [data-testid=graph-costs]",
	},
	{ name: "Deadlines", url: "/space/deadlines", ready: "[data-testid=deadline-open]" },
	{ name: "Deadline", url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-when]" },
	{ name: "Deadline with two lessons", before: twoLessons, url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-lessons] li:nth-child(2)" },
	{ name: "Homework deadline with its two keys", before: dropTwoLessons, url: "/space/deadline/{homeworkOpenDeadline}", ready: "[data-testid=deadline-head] [data-testid=deadline-work]" },
	{ name: "Progress with a homework next", before: `${homeworkCoversFile}\n${homeworkTomorrow}`, url: "/space", ready: "[data-testid=next-deadline] [data-testid=deadline-work]" },
	{ name: "Lesson with a sourced reply, an open quiz and the plan", url: "/chat/{lesson}", ready: "[data-testid=cite-list]" },
	{ name: "Lesson with a written-answer question", url: "/chat/{written}", ready: "[data-testid=question-dock]" },
	{ name: "Lesson with a written-answer question beside the teacher's panel", url: "/chat/{written}", ready: "[data-testid=question-dock]", setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Lesson with a plugin's page open", url: "/chat/{lesson}", ready: "[data-testid=lesson-plugin-flashcards]", setup: `document.querySelector("[data-testid=lesson-plugin-flashcards]").click()`, shows: "[data-testid=plugin-window] [data-testid=plugin-frame][data-state=ready]" },
	{ name: "Lesson, its menu", url: "/chat/{lesson}", ready: "[data-testid=lesson-more]", setup: `document.querySelector("[data-testid=lesson-more]").click()`, shows: "[data-testid=lesson-menu][data-state=open]" },
	{
		name: "Lesson, the Delete lesson? pop-up",
		url: "/chat/{lesson}",
		ready: "[data-testid=lesson-more]",
		setup: `document.querySelector("[data-testid=lesson-more]").click(); ${pause}; document.querySelector("[data-testid=ctx-delete]").click()`,
		shows: "[data-testid=delete-lesson-dialog]",
	},
	{
		name: "Lesson, its stats pop-up",
		url: "/chat/{lesson}",
		ready: "[data-testid=lesson-more]",
		setup: `document.querySelector("[data-testid=lesson-more]").click(); ${pause}; document.querySelector("[data-testid=ctx-stats]").click()`,
		shows: "[data-testid=stats-detail][data-state=open]",
	},
	{
		name: "Lesson with Find open in the bar",
		url: "/chat/{lesson}",
		ready: "[data-testid=cite-list]",
		setup: `document.querySelector("[data-testid=lesson-find]").click(); ${pause};
const box = document.querySelector("[data-testid=session-find] input");
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, "graph");
box.dispatchEvent(new Event("input", { bubbles: true })); ${pause}`,
		shows: "[data-testid=session-find-count]:not(:empty)",
	},
	{ name: "Homework lesson with a three-part problem on part (b)", url: "/chat/{homeworkOpen}", ready: "[data-part-current] ~ [data-part-head=c][aria-expanded=false]", shows: "[data-testid=lesson-assignment]" },
	{
		name: "Homework lesson with a folded part opened",
		url: "/chat/{homeworkOpen}",
		ready: "[data-part-head=a][aria-expanded=false]",
		setup: `document.querySelector("[data-part-head=a]").click()`,
		shows: "[data-part-head=a][aria-expanded=true]",
	},
	{ name: "Homework lesson with a problem shown as its page, on part (b)", url: "/chat/{homeworkPrinted}", ready: "[data-testid=page-piece] img", shows: "[data-testid=piece-veil]" },
	{
		name: "Homework lesson with a problem's page as printed",
		url: "/chat/{homeworkPrinted}",
		ready: "[data-testid=page-piece] img",
		setup: `document.querySelector("[data-testid=piece-printed]").click()`,
		shows: "[data-testid=piece-printed][aria-pressed=true]",
	},
	// The Document panel: the worksheet's pages beside the lesson, the open problem boxed. It stays open for this screen only.
	{
		name: "Homework lesson with the Document panel open",
		url: "/chat/{homeworkPrinted}",
		ready: "[data-testid=page-piece] img",
		setup: `document.querySelector("[data-testid=lesson-document]").click(); ${pause}; localStorage.removeItem("lh:sheet-dock:{homeworkPrinted}")`,
		shows: "[data-testid=document-dock] [data-testid=document-box]",
	},
	// The lesson on files (`{filesLesson}`): a practice quiz with its answer key, problem 1 done and problem 2 open as its page.
	{ name: "Lesson on files as it opens", url: "/chat/{filesLesson}", ready: "[data-testid=page-piece] img" },
	{
		name: "Lesson on files with the Document panel open",
		url: "/chat/{filesLesson}",
		ready: "[data-testid=page-piece] img",
		setup: `document.querySelector("[data-testid=lesson-document]").click(); ${pause}; localStorage.removeItem("lh:sheet-dock:{filesLesson}")`,
		shows: "[data-testid=document-dock]:has([data-testid=document-dock-pick]) [data-testid=document-box]",
	},
	{
		name: "Lesson on files with the answer key in the Document panel",
		url: "/chat/{filesLesson}",
		ready: "[data-testid=page-piece] img",
		setup: `document.querySelector("[data-testid=lesson-document]").click(); ${whenThere("[data-testid=document-dock-pick]")};
const pick = document.querySelector("select[data-testid=document-dock-pick]");
Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(pick, pick.options[1].value);
pick.dispatchEvent(new Event("change", { bubbles: true })); ${pause}; localStorage.removeItem("lh:sheet-dock:{filesLesson}")`,
		shows: "[data-testid=document-pages] [data-testid=document-page]:only-child img",
	},
	{ name: "Lesson with two steps, a sheet for each", url: "/chat/{twoSheets}", ready: "[data-testid=lesson-sheet] ~ [data-testid=lesson-sheet] [data-testid=sheet-step]" },
	{ name: "Lesson with two steps beside the teacher's panel", url: "/chat/{twoSheets}", ready: "[data-testid=lesson-sheet] ~ [data-testid=lesson-sheet] [data-testid=sheet-step]", setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Lesson with a question of the learner's own before the step's answer", url: "/chat/{askedFirst}", ready: "[data-testid=lesson-sheet] ~ [data-testid=lesson-sheet] [data-testid=user-message]", shows: "[data-testid=question-dock]" },
	{ name: "Lesson with a question whose choices are code, longer than the window", url: "/chat/{codeChoices}", ready: "[data-testid=question-dock] pre" },
	{ name: "Lesson with a problem longer than the window", url: "/chat/{longProblem}", ready: "[data-testid=open-problem]" },
	{ name: "Lesson with an open quiz in a tall window, Your turn pinned", url: "/chat/{lesson}", ready: "[data-testid=cite-list]", height: TALL },
	{ name: "Lesson with a question whose choices are code in a tall window", url: "/chat/{codeChoices}", ready: "[data-testid=question-dock] pre", height: TALL },
	{ name: "Lesson with a problem longer than a tall window", url: "/chat/{longProblem}", ready: "[data-testid=open-problem]", height: TALL },
	{ name: "Homework lesson before a problem opens, in a tall window", url: "/chat/{homeworkFirst}", ready: "[data-testid=next-problem-button]", height: TALL },
	{ name: "Lesson that opens with a problem, Your turn alone", url: "/chat/{problemFirst}", ready: ".lh-lesson-alone [data-testid=open-problem]" },
	{ name: "Homework lesson before a problem opens", url: "/chat/{homeworkFirst}", ready: "[data-testid=next-problem-button]" },
	{ name: "Homework lesson with fourteen problems, the first done", url: "/chat/{homeworkMany}", ready: "[data-testid=plan-fold]" },
	{ name: "Homework with fourteen problems, unfolded", url: "/chat/{homeworkMany}", ready: "[data-testid=plan-fold]", setup: unfoldSteps, shows: "[data-testid=plan-step][data-status=done] [data-testid=problem-pick]" },
	{ name: "Lesson with the steps unfolded", url: "/chat/{lesson}", ready: "[data-testid=cite-list]", setup: unfoldSteps, shows: "[data-testid=plan-step]" },
	{
		name: "Lesson with a quiz and the cheat sheet docked",
		url: "/chat/{lesson}",
		ready: "[data-testid=cite-list]",
		// The dock stays open for this screen only; the lessons after it open without it.
		setup: `document.querySelector("[data-testid=lesson-cheat-sheet]").click(); ${pause}; localStorage.removeItem("lh:sheet-dock:{lesson}")`,
		shows: "[data-testid=sheet-dock] [data-testid=sheet-dock-studio]",
	},
	{
		name: "Lesson in a space with no cheat sheet, the column open",
		url: "/chat/{sheetless}",
		ready: "[data-testid=next-problem-button]",
		setup: `document.querySelector("[data-testid=lesson-cheat-sheet]").click(); ${pause}; localStorage.removeItem("lh:sheet-dock:{sheetless}")`,
		shows: "[data-testid=sheet-dock-none]",
	},
	{ name: "An address that is no page", url: "/nowhere", ready: "[data-testid=not-found]" },
	{ name: "Space's plugin tab", url: "/space/plugin/flashcards", ready: "[data-testid=plugin-frame][data-state=ready]" },
	{ name: "Home, the strip's peek", url: "/", ready: deadlineCard, setup: peekOut, shows: peekShown },
	{ name: "Teacher's panel with no agent", url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Teacher's panel, the other agents", url: "/", ready: deadlineCard, setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=open-agent-menu]").click()`, shows: "[data-testid=open-agent-choices][data-state=open]" },
	{
		name: "Teacher's panel beside a lesson",
		url: "/chat/{lesson}",
		ready: "[data-testid=cite-list]",
		setup: openTeacher,
		shows: "[data-testid=terminal-none] [data-testid=open-agent]",
	},
	{ name: "Teacher's Activity", url: "/", ready: deadlineCard, setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=teacher-panel-activity]").click()`, shows: "[data-testid=teacher-panel-list] [data-testid=activity-list] > *" },
	{ name: "Settings, Connection", url: "/settings?section=connection", ready: "[data-testid=agent-status]" },
	{ name: "Settings, Teaching", url: "/settings?section=teaching", ready: "[data-testid^=area-][data-testid$=-instructions]:not(:disabled)" },
	{ name: "Settings, Plugins", url: "/settings?section=plugins", ready: "[data-testid=plugins-list]" },
	{ name: "Settings, Plugins, Add", url: "/settings?section=plugins", ready: "[data-testid=plugins-add][data-opens=sheet]", setup: `document.querySelector("[data-testid=plugins-add]").click()`, shows: "[data-testid=plugins-add-sheet] [data-testid=plugins-listed-meme-cards]" },
	{ name: "Settings, Plugins, the Remove question", url: "/settings?section=plugins", ready: "[data-testid=plugin-remove]", setup: `document.querySelector("[data-testid=plugin-remove]").click()`, shows: "[data-testid=plugin-remove-confirm]" },
	{
		name: "Settings, Teaching, instructions with the Discard question",
		url: "/settings?section=teaching",
		ready: "[data-testid^=area-][data-testid$=-instructions]:not(:disabled)",
		setup: `document.querySelector("[data-testid^=area-][data-testid$=-instructions]").click(); ${pause};
const box = document.querySelector("[data-testid=instructions-editor]");
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, box.value + " More.");
box.dispatchEvent(new Event("input", { bubbles: true })); ${pause};
document.querySelector("[data-testid=instructions-panel] button").click()`,
		shows: "[data-testid=instructions-discard]",
	},
	{ name: "Settings, Appearance", url: "/settings?section=appearance", ready: "[data-testid=appearance-preview]" },
	{ name: "Settings, Appearance, the font list", url: "/settings?section=appearance", ready: "[data-testid=font-trigger]", setup: `document.querySelector("[data-testid=font-trigger]").click()`, shows: "[data-testid=font-menu][data-state=open] [data-testid=font-option-default]" },
	{ name: "Settings, General", url: "/settings?section=general", ready: "[data-testid=teacher-name-row]" },
	{ name: "Cheat sheet, not made", url: sheetPage("{deadline}"), ready: "[data-testid=cheat-sheet-empty]" },
	{ name: "Cheat sheet, not made, beside the teacher's panel", url: sheetPage("{deadline}"), ready: "[data-testid=cheat-sheet-empty]", setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Cheat sheet, made, two pages", url: sheetPage("{sheetMade}"), ready: sheetDrawn(2), shows: "[data-testid=sheet-made]" },
	{ name: "Cheat sheet, made, its rules folded", url: sheetPage("{sheetMade}"), ready: sheetDrawn(2), setup: `document.querySelector("[data-testid=sheet-rules-toggle]").click()`, shows: "[data-testid=sheet-rules-toggle][aria-expanded=false]" },
	{ name: "Cheat sheet, made, beside the teacher's panel", url: sheetPage("{sheetMade}"), ready: sheetDrawn(2), setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Cheat sheet, two versions", url: sheetPage("{sheetVersions}"), ready: sheetDrawn(1), shows: "[data-testid=cheat-sheet-version] ~ [data-testid=cheat-sheet-version]" },
	{ name: "Deadline with a graded mock and a ready one", url: "/space/deadline/{sheetMade}", ready: "[data-testid=deadline-mock-continue]" },
	{ name: "Mock ready to start", url: mockPage("{mockReady}"), ready: "[data-testid=mock-ready] [data-testid=mock-start]" },
	{ name: "Mock being taken against the clock", url: mockPage("{mockRunning}"), ready: "[data-testid=mock-run] [data-testid=mock-clock]" },
	{ name: "Mock being taken, on a code question", url: mockPage("{mockRunning}"), ready: "[data-testid=mock-question-2]", setup: `document.querySelector("[data-testid=mock-question-2]").click()`, shows: "[data-testid=mock-run-examples]" },
	{ name: "Mock being taken, asking to end it", url: mockPage("{mockRunning}"), ready: "[data-testid=mock-end]", setup: `document.querySelector("[data-testid=mock-end]").click()`, shows: "[data-testid=mock-end-confirm]" },
	{ name: "Mock paused", url: mockPage("{mockPaused}"), ready: "[data-testid=mock-paused] [data-testid=mock-resume]" },
	{ name: "Mock graded", url: mockPage("{mockGraded}"), ready: "[data-testid=mock-results] [data-testid=mock-feedback]" },
	{ name: "Mock graded, an answer opened", url: mockPage("{mockGraded}"), ready: "[data-testid=mock-results] button[aria-expanded]", setup: `document.querySelector("[data-testid=mock-results] button[aria-expanded]").click()`, shows: "[data-testid=mock-results] .lh-collapse[data-state=open]" },
	// The two screens below leave requests waiting for an agent; the lesson that follows them ends them.
	{ name: "Cheat sheet while no agent is on it", before: askSheet, url: sheetPage("{waitingDeadline}"), ready: "[data-testid=sheet-working]" },
	{ name: "Mock being written", before: askMock, url: "/space/deadline/{waitingDeadline}", ready: "[data-testid=deadline-mock-continue]", setup: `document.querySelector("[data-testid=deadline-mock-continue]").click()`, shows: "[data-testid=mock-writing]" },
	{ name: "Lesson whose first reply waits for an agent", before: dropAskedRequests, url: waitingLesson, ready: turnRuns },
	{
		name: "Lesson whose first reply waits for an agent, beside the teacher's panel",
		url: "/chat/{pending}",
		ready: turnRuns,
		setup: openTeacher,
		shows: "[data-testid=terminal-none] [data-testid=open-agent]",
	},
	{ name: "Progress while a file waits for an agent", before: waitingFile, url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]" },
	{ name: "Graph while a file waits for an agent", url: "/graph", ready: "[data-testid=graph-picture] [data-testid=graph-topic]" },
	{ name: "Deadline while its request waits for an agent", before: waitingRequest, url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-when]" },
	// The stand-in agent is started from the waiting lesson's teacher window, and the lesson's start key goes.
	{
		name: "Lesson whose first reply an agent took",
		url: "/chat/{pending}",
		ready: turnRuns,
		setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=open-agent]").click()`,
		shows: ".lh-reading:not(:has([data-testid=work-frame-open])) [data-testid=stop-turn]",
	},
	// Stop is pressed at the first width; the widths after it open the lesson already stopped.
	{
		name: "Lesson whose first reply was stopped with nothing written",
		url: "/chat/{pending}",
		ready: `${turnRuns}, [data-testid=nothing-written]`,
		setup: `document.querySelector("${turnRuns}")?.click()`,
		shows: "[data-testid=nothing-written]",
	},
	// Starter keys show only while no lesson turn waits, so the waiting lesson goes first. The stand-in agent may already run.
	{
		name: "The agent's screen",
		before: dropWaitingLesson,
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=open-agent]")?.click()`,
		shows: "[data-testid=terminal-starters] [data-testid=terminal-starter]",
	},
	// The longest starter key: "Get me ready for" the deadline's name.
	{ name: "The agent's screen on a deadline", url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-when]", setup: openTeacher, shows: "[data-testid=terminal-starters] [data-testid=terminal-starter]" },
	{
		name: "The agent's screen with everything the teacher can do",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${whenThere("[data-testid=terminal-everything]")}; document.querySelector("[data-testid=terminal-everything]").click()`,
		shows: "[data-testid=terminal-ideas] [data-testid=terminal-idea]",
	},
	// Onboarding's mark: the panel opens by itself on Home, once.
	{
		name: "A new learner's first look at Home",
		before: `localStorage.setItem("lh:teacher-welcome", "1")`,
		url: "/",
		ready: deadlineCard,
		shows: "[data-testid=terminal-starters] [data-testid=terminal-starter]",
	},
	// The stand-in teacher runs by now. The window's own page, and the column of the main window while the shell says the window is open.
	{
		name: "The terminal window",
		url: "/terminal-window",
		ready: "[data-testid=terminal-window] [data-testid=teacher-panel-put-back]",
		setup: `${pause}; document.querySelector("[data-testid=open-agent]")?.click()`,
		shows: "[data-testid=terminal-window] [data-testid=terminal-starter]",
	},
	{
		name: "Teacher's column while the terminal is in its window",
		url: "/",
		ready: deadlineCard,
		setup: `window.__lhPush("terminal-window", { open: true }); ${pause}; ${openTeacher}`,
		shows: "[data-testid=teacher-panel] [data-testid=teacher-panel-put-back]",
	},
	{ name: "Home with no deadline", before: dropDeadlines, url: "/", ready: "[data-testid=today-empty]" },
	{ name: "Home on a busy day", before: busyDay, url: "/", ready: "[data-testid=week-columns] [data-testid=week-more]", shows: "[data-testid=week-later]" },
	{ name: "Home, the week unfolded", url: "/", ready: "[data-testid=week-columns] [data-testid=week-more]", setup: `document.querySelector("[data-testid=week-more]").click()`, shows: "[data-testid=week-rest][data-state=open]" },
	{ name: "Deadlines while the top bar asks about a late one", before: lateHomework, url: "/space/deadlines", ready: "[data-testid=overdue-notice] [data-testid=overdue-notice-done]" },
	{
		name: "Progress with a path, all shown",
		before: `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, activeSpace: "{pathSpace}" }) })${HTTP_OK}`,
		url: "/space",
		ready: "[data-testid=space-path-show-all] + [data-testid=path-change]",
		setup: `document.querySelector("[data-testid=space-path-show-all]").click()`,
		shows: "[data-testid=space-path-rows] li:nth-child(7)",
	},
	{ name: "Files, the linked folder's box", before: linkedFolder, url: "/space/files", ready: "[data-testid=space-folder]", setup: `document.querySelector("[data-testid=space-folder]").click()`, shows: "[data-testid=space-folder-box][data-state=open]" },
	{ name: "The plus list with a closed space", before: closedSpace, url: "/", ready: "[data-testid=spaces-plus]", setup: `document.querySelector("[data-testid=spaces-plus]").click()`, shows: "[data-testid=spaces-plus-list][data-state=open] [data-testid=closed-space-{pathSpace}]" },
	{
		name: "Lesson with a 40-letter title among five open spaces",
		before: `${moreSpaces}\n${longTitle}`,
		url: "/chat/{lesson}",
		ready: `[data-testid=bar-crumb] [data-testid=lesson-title][title="${LONG_TITLE}"]`,
		shows: "[data-testid=space-tabs-strip] > :nth-child(5)",
	},
	{ name: "Lesson with no space", before: noSpace, url: "/chat/{written}", ready: "[data-testid=question-dock]", shows: "[data-testid=spaces-plus] ~ [data-testid=bar-crumb] [data-testid=lesson-title]" },
	{
		// The stand-in teacher goes back to a chat, which has a line typed in it: a chat to list.
		name: "Teacher's chats under the Chats key",
		before: `const shell = window.lh.terminals;
const running = (await shell.list()).find((t) => t.role === "teacher" && !t.ended);
if (running) await shell.stop(running.id);
for (let tries = 0; (await shell.list()).some((t) => t.role === "teacher" && !t.ended); tries++) {
	if (tries > 50) throw new Error("the teacher never stopped");
	await new Promise((done) => setTimeout(done, 100));
}
await shell.start("teacher", "claude", "7c9e6679-7425-40de-944b-e07fc1f90ae7")`,
		url: "/",
		ready: "[data-testid=strip]",
		setup: `if (!document.querySelector("[data-teacher-panel]")) { ${openTeacher}; ${pause}; }
for (let tries = 0; !document.querySelector("[data-testid=teacher-panel-chats]"); tries++) {
	if (tries > 100) throw new Error("the Chats key never showed");
	await new Promise((done) => setTimeout(done, 100));
}
document.querySelector("[data-testid=teacher-panel-chats]").click()`,
		shows: "[data-testid=teacher-panel-list] [data-testid=teacher-chat-open]",
	},
	{ name: "Progress, a new space", before: newSpace, url: "/space", ready: "[data-testid=space-start] [data-testid=space-start-path]" },
	// With a lesson the new space is no longer empty: the deadline's place holds the two ways it still lacks.
	{ name: "Progress, a lesson but no deadline", before: lessonInNewSpace, url: "/space", ready: "[data-testid=next-deadline-none] [data-testid=space-start-path]" },
	{
		name: "Onboarding",
		before: `${dropLateHomework}; const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, onboarded: false }) })${HTTP_OK}`,
		url: "/",
		ready: "[data-testid=onboarding-intro]",
	},
];
