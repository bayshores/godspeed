import { PRINTED_HOLDS, TALK_HOLDS, TALK_ROUND, WAITING_TOPIC } from "./layout-lessons.mjs";

/**
 * layout-screens.mjs — the screens `npm run layout` checks, in order.
 *
 * Every screen is checked at 1440, 1100 and 640 points wide (640 is the narrowest window), a lesson ("/chat/")
 * at 1320 and 800 too, and a screen with `widths` only at those (widthsOf). A screen opens at `url`, waits for `ready`, runs `setup` in the page (clicks), then waits for
 * `shows`; `helper` asks the stand-in helper, holding a reply, to `read` files, `approve` a command it asks to run, `stream` half a reply, or in the
 * teacher's round of work `change` a space and be `done` (layout-helper.mjs). `ready` and `shows` name something drawn from the screen's data, not its frame, so the
 * check never runs on a screen still loading. `height` gives it a window higher than the
 * check's own. `before` runs in the page first, on the screen
 * before it, for a change of data; it stays for the screens after it. `agent` puts the stand-in agent
 * in a state for the setup card's checks ("signed-out", "old", or "missing"), for that screen only. `{space}`, `{lesson}`,
 * `{deadline}`, `{homeworkOpen}`, `{homeworkFirst}`, `{homeworkMany}`, `{homeworkPrinted}`, `{homeworkOpenDeadline}`, `{longProblem}`, `{problemFirst}`, `{twoSheets}`, `{askedFirst}`, `{codeChoices}`, `{codeWrite}`, the lessons that stand at a state of "Your turn" `{explained}`, `{quizAnswered}`, `{concluded}`, `{skipped}`, `{discarded}` and `{lastTopic}`, `{pending}`, `{sheetless}`, `{pathSpace}`, `{vault}`, the cheat sheet deadlines `{sheetMade}`, `{sheetVersions}` and `{waitingDeadline}`, the mock deadline `{mockRunDeadline}` and the mocks `{mockGraded}`, `{mockReady}`, `{mockRunning}` and `{mockPaused}` are the made-up data's ids (layout-seed.mjs). Scripts may await.
 */

const WIDTHS = [1440, 1100, 640];
/** A lesson is also checked at 1320, just past the room where a short question is set larger, and at 800, where its one
 *  column is not yet at its narrowest. */
const LESSON_WIDTHS = [1440, 1320, 1100, 800, 640];
/** The widths at which "Your turn" is pinned under one column of lesson text. */
const ONE_COLUMN = [800, 640];

/** The widths a screen is checked at, widest first. */
export function widthsOf(screen) {
	return screen.widths ?? (screen.url.startsWith("/chat/") ? LESSON_WIDTHS : WIDTHS);
}
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
/** Makes a teacher panel chat and sends it `text`, as the panel's first send does; the reply runs on in the server. */
const talk = (text) => `const made = await (await fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "talk", text: ${JSON.stringify(text)} }) })).json();
const sent = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: made.id, input: { type: "text", text: ${JSON.stringify(text)} } }) });
await sent.body?.cancel()`;
/** Stops every teacher panel chat's running reply. */
const stopTalk = `const { chats } = await (await fetch("/api/chats?kind=talk")).json();
for (const chat of chats.filter((c) => c.running)) await fetch("/api/activity/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "turn", id: chat.id }) })`;
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
const untickHomework = `await fetch("/api/spaces/{space}/deadlines/{homeworkOpenDeadline}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: false }) })${HTTP_OK};`;
const homeworkCard = "[data-teacher-target='deadline:{homeworkOpenDeadline}']";
/** Two Study lessons on the exam, so its page lists them. */
const twoLessons = `for (let n = 0; n < 2; n++) await fetch("/api/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spaceId: "{space}", deadlineId: "{deadline}" }) })${HTTP_OK};`;
const dropTwoLessons = `const { chats } = await fetch("/api/chats?space={space}")${HTTP_OK}.then((r) => r.json());
for (const c of chats.filter((c) => c.deadlineId === "{deadline}" && c.kind === "study")) await fetch("/api/chats/" + c.id + "?mode=preserve-graph", { method: "DELETE" })${HTTP_OK};`;
/** Waits in the page, up to 10 s, until the teacher's round of work has ended. */
const roundEnded = `for (let n = 0; (await fetch("/api/teacher-work")${HTTP_OK}.then((r) => r.json())).live; n++) {
	if (n > 100) throw new Error("the teacher's round of work never ended");
	${pause};
}`;
/** The learner keeps typing, so Follow waits; the next full load ends it. */
const keepTyping = `const type = () => document.dispatchEvent(new Event("input", { bubbles: true }));
type();
window.__layoutTyping ??= setInterval(type, 400);`;

/** Every deadline the seed made, so Home has none. */
const dropDeadlines = ["{deadline}", "{homeworkOpenDeadline}", "{homeworkFirstDeadline}", "{homeworkManyDeadline}", "{homeworkPrintedDeadline}", "{sheetMade}", "{sheetVersions}", "{mockRunDeadline}", "{waitingDeadline}"].map((id) => `await fetch("/api/spaces/{space}/deadlines/${id}", { method: "DELETE" })${HTTP_OK};`).join("\n");

/** A space whose only two deadlines are past and of different kinds: no rhythm, nothing coming up, so
 *  every page asks whether it is missing a deadline. */
const gapSpace = `const made = await fetch("/api/spaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Gap check", description: "A space with nothing coming up" }) })${HTTP_OK}.then((r) => r.json());
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv");
for (const [kind, name, n] of [["homework", "Problem set", -3], ["quiz", "Short quiz", -5]]) await fetch("/api/spaces/" + made.space.id + "/deadlines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, date: day(n), fileIds: [] }) })${HTTP_OK};`;
/** Closes it, so the screens after it have no gap card. */
const dropGapSpace = `const { spaces } = await fetch("/api/spaces")${HTTP_OK}.then((r) => r.json());
const gapped = spaces.find((s) => s.name === "Gap check");
if (gapped) await fetch("/api/spaces/" + gapped.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ closed: true }) })${HTTP_OK};`;

/** Three projects a week apart in the lab space, the newest 4 days ago, all ticked done: a fourth
 *  looks missing in 3 days, so Home's week and the Deadlines tab draw its outline. */
const projectRhythm = `const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv");
const base = "/api/spaces/{space}/deadlines";
const json = { "content-type": "application/json" };
for (const [name, n] of [["Project 1", -18], ["Project 2", -11], ["Project 3", -4]]) {
	const { deadline } = await fetch(base, { method: "POST", headers: json, body: JSON.stringify({ kind: "project", name, date: day(n), fileIds: [] }) })${HTTP_OK}.then((r) => r.json());
	await fetch(base + "/" + deadline.id, { method: "PUT", headers: json, body: JSON.stringify({ done: true }) })${HTTP_OK};
}`;
/** Takes the projects away again, so the screens after them are as before. */
const dropProjectRhythm = `const { deadlines } = await fetch("/api/spaces/{space}/deadlines")${HTTP_OK}.then((r) => r.json());
for (const d of deadlines.filter((d) => /^Project \\d$/.test(d.name))) await fetch("/api/spaces/{space}/deadlines/" + d.id, { method: "DELETE" })${HTTP_OK};`;

/** A folder that is always there and always empty, linked to the second space. */
const linkedFolder = `await fetch("/api/spaces/{pathSpace}/folder", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/private/var/empty" }) })${HTTP_OK};`;
/** The second space closed, so the plus list has a closed space; the first is the open one again. */
const closedSpace = `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json());
await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, activeSpace: "{space}" }) })${HTTP_OK};
await fetch("/api/spaces/{pathSpace}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ closed: true }) })${HTTP_OK};`;

/** The lesson made and never sent: opened at this address, the window sends its first message once,
 *  as Study does, and the stand-in helper holds its reply. */
const waitingLesson = `/chat/{pending}?prompt=${encodeURIComponent(WAITING_TOPIC)}`;
/** A lesson turn running: Stop in the writing row. */
const turnRuns = "[data-testid=stop-turn]";
/** The desk in that lesson's text while the teacher works on its reply. */
const deskUp = "[data-testid=agent-at-work]";
/** A line the learner sends in the printed homework, whose turn the stand-in helper holds. */
const printedLine = `await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: "{homeworkPrinted}", input: { type: "text", text: ${JSON.stringify(PRINTED_HOLDS)} } }) })${HTTP_OK};`;
/** That turn stopped, so no teacher holds it for the screens after it. */
const dropPrintedLine = `await fetch("/api/activity/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "turn", id: "{homeworkPrinted}" }) });`;
/** Waits, up to 10 s, until that turn has ended, so a line sent after it starts a turn of its own. */
const printedTurnEnded = `for (let n = 0; n < 100; n++) {
	const { turnInFlight } = await fetch("/api/chats/{homeworkPrinted}")${HTTP_OK}.then((r) => r.json());
	if (!turnInFlight) break;
	${pause};
}`;
/** That lesson's reply stopped (a screen before may have stopped it already) and the lesson deleted, so the screens after it are as before. A
 *  lesson can't be deleted while its turn runs, so the delete is tried until the stop has ended it. */
const dropWaitingLesson = `await fetch("/api/activity/abort", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "turn", id: "{pending}" }) });
for (let tries = 0; ; tries++) {
	const res = await fetch("/api/chats/{pending}?mode=preserve-graph", { method: "DELETE" });
	if (res.ok) break;
	if (tries > 50) throw new Error("the waiting lesson was never deleted: " + res.status);
	await new Promise((done) => setTimeout(done, 100));
}`;


/** What the notes folder tells the page, made up: the server writes no notes in this check, so the page's reads of them are answered here,
 *  one page for each of the lab space's real topics, and the server's own "notes changed" event, which a write of the same setting sends,
 *  makes the page read again. */
const RECALLS = ["How do you undo ax + b = c, one step at a time?", "When may you do the same thing to both sides of an equation?", "What do you do first to isolate the variable?", "What do the slope and the intercept tell you about a line?", "How does a word problem become an equation?"];
const KINDS = ["godspeed", "kept", "mine", "godspeed", "godspeed"];
/** Two more pages, so Progress has more than a row of them. */
const EXTRA_PAGES = [
	{ topicId: "extra-1", name: "Systems of equations", recall: "How many solutions can two lines share?", color: "", kind: "godspeed", path: "Lab Algebra/Systems of equations.md", saving: false },
	{ topicId: "extra-2", name: "Inequalities", recall: "When does an inequality flip?", color: "", kind: "godspeed", path: "Lab Algebra/Inequalities.md", saving: false },
];
/** The page-side list of the first `take` topics' pages (more with `extra`); the `waiting` ones are still being written. */
const pagesOf = (take, { extra = false, waiting = [] } = {}) => `[...topics.slice(0, ${take}).map((topic, n) => ({
	topicId: topic.id, name: topic.name, recall: ${JSON.stringify(RECALLS)}[n] ?? null, color: topic.color, kind: ${JSON.stringify(KINDS)}[n],
	path: "Lab Algebra/" + topic.name + ".md", saving: false, ...(${JSON.stringify(waiting)}.includes(n) ? { kind: "godspeed", path: null, saving: true } : {}),
})), ...${extra ? JSON.stringify(EXTRA_PAGES) : "[]"}.map((page) => ({ ...page, color: topics[0].color }))]`;
/** Answers the page's reads of the notes (a path with "vault-notes") with `answer`, then has the server say the notes changed. `status` is what the notes folder's own read says besides. */
const notesAre = (answer, status = "{}") => `window.__realFetch ??= window.fetch.bind(window);
const { topics: all } = await (await window.__realFetch("/api/progress?space={space}&today=" + new Date().toLocaleDateString("en-CA"))).json();
const topics = all.filter((topic) => !topic.ungrouped);
window.fetch = (url, init) => {
	const path = String(url);
	if (path.includes("vault-notes")) return Promise.resolve(Response.json(${answer}));
	if (path === "/api/vault" && !init?.method) return window.__realFetch(url, init).then(async (r) => Response.json({ ...(await r.json()), ...${status} }));
	return window.__realFetch(url, init);
};
await window.__realFetch("/api/vault", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ words: "teacher" }) })${HTTP_OK}`;
const spaceNotes = (pages) => notesAre(`{ notes: ${pages} }`);
const lessonNotes = (pages, asks = "[]") => notesAre(`{ pages: ${pages}, asks: ${asks} }`);
const ASKED = `[{ topicId: topics[0].id, name: topics[0].name, maxLength: 600 }]`;
const unlinkVault = `await fetch("/api/vault", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: null }) })${HTTP_OK};`;

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
/** A click on the topic that needs two topics first and leads to two more. */
const pickMiddleTopic = `[...document.querySelectorAll("[data-testid=graph-topic]")].find((topic) => topic.getAttribute("aria-label").startsWith("Solving linear equations")).click()`;
/** A click on the first loose square in the Graph's picture, where the second space's two facts wait for topics. */
const pickSquare = `{ const at = document.querySelector("[data-testid=graph-loose] path").getBoundingClientRect();
document.querySelector("[data-testid=graph-picture]").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: at.left + at.width / 2, clientY: at.top + at.height / 2, detail: 1 })); }`;

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

/** A deadline with nothing made asks for its cheat sheet and for a mock, which the stand-in helper holds unanswered. */
const askSheet = `await fetch("/api/spaces/{space}/deadlines/{waitingDeadline}/cheat-sheet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ask", text: "Make my cheat sheet for the spring exam." }) })${HTTP_OK};`;
const askMock = `await fetch("/api/spaces/{space}/mocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deadlineId: "{waitingDeadline}", questions: 5, minutes: 60 }) })${HTTP_OK};`;
/** Both requests ended, so the stand-in helper lets them go and the screens after are as before. */
const dropAskedRequests = `await fetch("/api/spaces/{space}/deadlines/{waitingDeadline}/cheat-sheet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) })${HTTP_OK};
const { mocks } = await fetch("/api/spaces/{space}/mocks?deadline={waitingDeadline}")${HTTP_OK}.then((r) => r.json());
for (const mock of mocks) await fetch("/api/spaces/{space}/mocks/" + mock.id, { method: "DELETE" })${HTTP_OK};`;
/** The cheat sheet page's pages drawn: pdf.js paints each into a canvas a moment after the page opens. */
const sheetDrawn = (page) => `[data-testid=cheat-sheet-page]:nth-child(${page}) canvas`;
const sheetPage = (deadline) => `/space/deadline/${deadline}/cheat-sheet`;
const mockPage = (mock) => `/space/mock/{space}/${mock}`;
/** The Sounds switch, which the run opens with off (layout.mjs); Noise's word shows only with it on. */
const sounds = (on) => `await fetch("/api/settings/general", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sounds: ${on} }) })${HTTP_OK}`;
/** The window's sound goes nowhere, so Noise plays unheard. */
const unheard = `window.AudioContext = class extends AudioContext { get destination() { return (this.sink ??= this.createMediaStreamDestination()); } }`;

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
		name: "Graph, a topic with several topics it needs and leads to",
		url: "/graph",
		ready: "[data-testid=graph-topic]",
		setup: `${pickMiddleTopic}; ${cameraRests(`picture().hasAttribute("data-near") && document.querySelector("[data-figure]")`)}; ${fitsWindow}`,
		// Links that do not fit the slip whole fold behind "N more", so a group shows a chip either way.
		shows: "[data-testid=topic-pane]:has([data-testid=needs-first] [data-testid=topic-link]):has([data-testid=leads-to] :is([data-testid=topic-link], [data-testid=links-more]))",
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
		setup: `${pickTopic}; ${pause}; document.querySelector("[data-testid=topic-pane] [data-testid=fact-moon]").click()`,
		shows: "[data-testid=graph-panel] [data-testid=fact-pane]",
	},
	{
		name: "Graph, a fact from a file that builds on facts and leads to others",
		url: "/graph",
		ready: "[data-testid=graph-topic]",
		setup: `${pickMiddleTopic}; ${pause}; document.querySelector("[data-testid=topic-pane] [data-testid=fact-moon][aria-label^='Isolate the variable']").click(); ${cameraRests(`picture().hasAttribute("data-near")`)}; ${fitsWindow}`,
		shows: "[data-testid=fact-pane]:has([data-testid=fact-source-open]):has([data-testid=builds-on] [data-testid=fact-link]):has([data-testid=fact-leads-to] :is([data-testid=fact-link], [data-testid=links-more]))",
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
	{ name: "Deadlines, the key that asks the teacher to update", url: "/space/deadlines", ready: "[data-testid=deadlines-update]" },
	{ name: "Home with the outline of a missing deadline", before: projectRhythm, url: "/", ready: "[data-testid=week-gap]" },
	{ name: "Home, the outline picked into the card", url: "/", ready: "[data-testid=week-gap]", setup: `document.querySelector("[data-testid=week-gap]").click()`, shows: "[data-testid=today-gap] [data-testid=today-gap-add]" },
	{ name: "Deadlines with the outline of a missing deadline", url: "/space/deadlines", ready: "[data-testid=gap-row] [data-testid=gap-row-add]" },
	{ name: "Deadline", before: dropProjectRhythm, url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-when]" },
	{ name: "Deadline with two lessons", before: twoLessons, url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-lessons] li:nth-child(2)" },
	{ name: "Homework deadline with its two keys", before: dropTwoLessons, url: "/space/deadline/{homeworkOpenDeadline}", ready: "[data-testid=deadline-head] [data-testid=deadline-work]" },
	{ name: "Progress with a homework next", before: `${homeworkCoversFile}\n${homeworkTomorrow}`, url: "/space", ready: "[data-testid=next-deadline] [data-testid=deadline-work]", shows: "[data-testid=next-deadline-next]" },
	{ name: "Progress, the next deadline marked done", url: "/space", ready: `${homeworkCard} [data-testid=next-deadline-done]`, setup: `document.querySelector("${homeworkCard} [data-testid=next-deadline-done]").click()`, shows: `${homeworkCard} [data-testid=next-deadline-undo]` },
	{ name: "Lesson with a sourced reply, an open quiz and the plan", before: untickHomework, url: "/chat/{lesson}", ready: "[data-testid=cite-list]" },
	{ name: "Lesson with a written-answer question", url: "/chat/{written}", ready: "[data-testid=question-dock]" },
	{ name: "Lesson with a written-answer question beside the teacher's panel", url: "/chat/{written}", ready: "[data-testid=question-dock]", setup: openTeacher, shows: "[data-testid=talk-gives-way]" },
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
	{ name: "Homework lesson with a three-part problem on part (b)", url: "/chat/{homeworkOpen}", ready: "[data-part-current] ~ [data-part-head=c][aria-expanded=false]", shows: "[data-testid=turn-sheet][data-plate] [data-part-current]" },
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
	{ name: "Lesson with two steps beside the teacher's panel", url: "/chat/{twoSheets}", ready: "[data-testid=lesson-sheet] ~ [data-testid=lesson-sheet] [data-testid=sheet-step]", setup: openTeacher, shows: "[data-testid=talk-gives-way]" },
	{ name: "Lesson with a question of the learner's own before the step's answer", url: "/chat/{askedFirst}", ready: "[data-testid=lesson-sheet] ~ [data-testid=lesson-sheet] [data-testid=user-message]", shows: "[data-testid=question-dock]" },
	{ name: "Lesson with a question whose choices are code, longer than the window", url: "/chat/{codeChoices}", ready: "[data-testid=question-dock] pre" },
	{ name: "Lesson with a question answered in the code editor", url: "/chat/{codeWrite}", ready: "[data-testid=code-editor-host] .cm-content" },
	{ name: "Lesson with a problem longer than the window", url: "/chat/{longProblem}", ready: "[data-testid=open-problem]" },
	{ name: "Lesson with an open quiz in a tall window, Your turn pinned", url: "/chat/{lesson}", ready: "[data-testid=cite-list]", height: TALL },
	{ name: "Lesson with a question whose choices are code in a tall window", url: "/chat/{codeChoices}", ready: "[data-testid=question-dock] pre", height: TALL },
	{ name: "Lesson with a problem longer than a tall window", url: "/chat/{longProblem}", ready: "[data-testid=open-problem]", height: TALL },
	{
		name: "Lesson with a long problem folded over the text",
		url: "/chat/{longProblem}",
		ready: "[data-testid=turn-whole][aria-expanded=true]",
		setup: `document.querySelector("[data-testid=turn-whole]").click()`,
		shows: "[data-testid=turn-whole][aria-expanded=false]",
		height: TALL,
		widths: ONE_COLUMN,
	},
	{ name: "Homework lesson before a problem opens, in a tall window", url: "/chat/{homeworkFirst}", ready: "[data-testid=next-problem-button]", height: TALL },
	// "Your turn" with nothing to answer, after each way a step can end.
	{ name: "Lesson where the teacher explained and asked nothing, Your turn holds Continue", url: "/chat/{explained}", ready: "[data-testid=next-problem-button][data-action=next]" },
	{ name: "Lesson with a quiz answered and the teacher's reply landed", url: "/chat/{quizAnswered}", ready: "[data-testid=next-problem-button][data-action=next]" },
	{ name: "Lesson with a problem concluded, Continue to the next topic", url: "/chat/{concluded}", ready: "[data-testid=next-problem-button][data-action=keep-going]" },
	{ name: "Lesson with a question skipped and the teacher's reply landed", url: "/chat/{skipped}", ready: "[data-testid=next-problem-button][data-action=next]" },
	{ name: "Lesson with a problem discarded", url: "/chat/{discarded}", ready: "[data-testid=next-problem-button]" },
	{ name: "Lesson at the end of its last topic, Done for today", url: "/chat/{lastTopic}", ready: "[data-testid=next-problem-button][data-action=done-for-today]" },
	{ name: "Lesson that opens with a problem, Your turn alone", url: "/chat/{problemFirst}", ready: "[data-testid=open-problem]" },
	{ name: "Homework lesson before a problem opens", url: "/chat/{homeworkFirst}", ready: "[data-testid=next-problem-button]" },
	// The method is taught first with a figure the teacher drew; "Try asking" has the key that asks for one.
	{ name: "Homework lesson with a figure under the method", url: "/chat/{homeworkFirst}", ready: "[data-testid=visual-svg] img", shows: "[data-testid=lesson-idea]" },
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
	// No chat yet: the panel opens on a new one, with what the teacher can be asked here.
	{ name: "Teacher chat, a new chat", url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=talk-try] [data-testid=talk-starter]" },
	// A Lab Algebra lesson: the panel's box gives way to the lesson's. Opening it also makes Lab Algebra the active space again for the Progress screens below.
	{ name: "Teacher's panel beside a lesson", url: "/chat/{lesson}", ready: "[data-testid=cite-list]", setup: openTeacher, shows: "[data-testid=talk-gives-way]" },
	{ name: "Teacher's Activity", url: "/", ready: deadlineCard, setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=teacher-panel-activity]").click()`, shows: "[data-testid=teacher-panel-list] [data-testid=activity-list] > *" },
	{
		name: "Settings, Teacher",
		url: "/settings?section=teacher",
		ready: "[data-testid=agent-card] [data-testid=agent-model-select]",
		shows: "[data-testid=group-teacher]:has([data-testid=teacher-name-row]) [data-testid=agent-folder-path]",
	},
	{ name: "Settings, Teacher, logged out", agent: "signed-out", url: "/settings?section=teacher", ready: "[data-testid=agent-row-account][data-mark=need] [data-testid=agent-key]" },
	{
		name: "Settings, Teacher, logging in with the code field",
		agent: "signed-out",
		url: "/settings?section=teacher",
		ready: "[data-testid=agent-row-account][data-mark=need] [data-testid=agent-key]",
		setup: `document.querySelector("[data-testid=agent-row-account] [data-testid=agent-key]").click()`,
		shows: "[data-testid=agent-row-account][data-mark=wait] [data-testid=agent-login-code]",
	},
	{ name: "Settings, Teacher, too old", agent: "old", url: "/settings?section=teacher", ready: "[data-testid=agent-row-version][data-mark=need] [data-testid=agent-key]" },
	{ name: "Settings, Teacher, not installed", agent: "missing", url: "/settings?section=teacher", ready: "[data-testid=agent-row-version][data-mark=need] [data-testid=agent-key]" },
	// While the agent can't run, the writing row's place says why, with the key that fixes it.
	{ name: "Teacher's panel while the agent isn't logged in", agent: "signed-out", url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=panel-setup][data-state=open] [data-testid=agent-compact] [data-testid=agent-key]" },
	{
		name: "Teacher's panel while logging in with the code field",
		agent: "signed-out",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=panel-setup] [data-testid=agent-key]").click()`,
		shows: "[data-testid=panel-setup] [data-testid=agent-compact] [data-testid=agent-login-code]",
	},
	{ name: "Teacher's panel while the agent is too old", agent: "old", url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=panel-setup][data-state=open] [data-testid=agent-compact] [data-testid=agent-key]" },
	{ name: "Home, the strip's peek while the agent isn't logged in", agent: "signed-out", url: "/", ready: deadlineCard, setup: peekOut, shows: peekShown },
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
	{ name: "Settings, General", url: "/settings?section=general", ready: "[data-testid=group-sounds]", shows: "[data-testid=group-vault] [data-testid=vault-pick]" },
	{
		name: "Settings, General, an Obsidian vault picked",
		before: `await fetch("/api/vault", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "{vault}" }) })${HTTP_OK};`,
		url: "/settings?section=general",
		ready: "[data-testid=group-vault] [data-testid=vault-folder][data-state=ok]",
		shows: "[data-testid=vault-unlink]",
	},
	{ name: "Progress with notes in Obsidian", url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]", setup: spaceNotes(pagesOf(5, { extra: true })), shows: "[data-testid=notes-card] [data-testid=note-page]" },
	{ name: "Progress with notes, all shown", url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]", setup: `${spaceNotes(pagesOf(5, { extra: true }))};\n${whenThere("[data-testid=notes-all]")}; document.querySelector("[data-testid=notes-all]").click()`, shows: "[data-testid=notes-card][data-all] [data-testid=note-page]:nth-child(7)" },
	{ name: "Graph, a topic with a note", url: "/graph", ready: "[data-testid=graph-topic]", setup: `${spaceNotes(pagesOf(5))}; ${pickTopic}; ${cameraRests(`picture().hasAttribute("data-near") && document.querySelector("[data-figure]")`)}`, shows: "[data-testid=topic-pane] [data-testid=topic-note-open]" },
	{ name: "Lesson end, the notes being saved", height: TALL, url: "/chat/{lastTopic}", ready: "[data-testid=your-turn]", setup: lessonNotes(pagesOf(3, { waiting: [2] })), shows: "[data-testid=end-notes] [data-saving]" },
	{ name: "Lesson end, the notes saved", height: TALL, url: "/chat/{lastTopic}", ready: "[data-testid=your-turn]", setup: lessonNotes(pagesOf(3)), shows: "[data-testid=notes-saved]" },
	{
		name: "Lesson end, asked for my words",
		height: TALL,
		url: "/chat/{lastTopic}",
		ready: "[data-testid=your-turn]",
		setup: lessonNotes(pagesOf(3), ASKED),
		shows: "[data-testid=words-leave]",
	},
	{ name: "Notes that could not be saved", url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]", setup: notesAre(`{ notes: ${pagesOf(3, { waiting: [0, 1] })} }`, `{ waiting: { names: [topics[0].name, topics[1].name], why: "The disk is full." } }`), shows: "[data-testid=vault-notice] [data-testid=vault-notice-key]" },
	{ name: "Progress with no notes folder", before: unlinkVault, url: "/space", ready: "[data-testid=lesson-record] [data-testid=lesson-row]" },
	{ name: "Cheat sheet, not made", url: sheetPage("{deadline}"), ready: "[data-testid=cheat-sheet-empty]" },
	{ name: "Cheat sheet, not made, beside the teacher's panel", url: sheetPage("{deadline}"), ready: "[data-testid=cheat-sheet-empty]", setup: openTeacher, shows: "[data-testid=talk-gives-way]" },
	{ name: "Cheat sheet, made, two pages", url: sheetPage("{sheetMade}"), ready: sheetDrawn(2), shows: "[data-testid=sheet-made]" },
	{ name: "Cheat sheet, made, its rules folded", url: sheetPage("{sheetMade}"), ready: sheetDrawn(2), setup: `document.querySelector("[data-testid=sheet-rules-toggle]").click()`, shows: "[data-testid=sheet-rules-toggle][aria-expanded=false]" },
	{ name: "Cheat sheet, made, beside the teacher's panel", url: sheetPage("{sheetMade}"), ready: sheetDrawn(2), setup: openTeacher, shows: "[data-testid=talk-gives-way]" },
	{ name: "Cheat sheet, two versions", url: sheetPage("{sheetVersions}"), ready: sheetDrawn(1), shows: "[data-testid=cheat-sheet-version] ~ [data-testid=cheat-sheet-version]" },
	{ name: "Deadline with a graded mock and a ready one", url: "/space/deadline/{sheetMade}", ready: "[data-testid=deadline-mock-continue]" },
	{ name: "Mock ready to start", url: mockPage("{mockReady}"), ready: "[data-testid=mock-ready] [data-testid=mock-start]" },
	{ name: "Mock being taken against the clock", url: mockPage("{mockRunning}"), ready: "[data-testid=mock-run] [data-testid=mock-clock]" },
	{ name: "Mock being taken, on a code question", url: mockPage("{mockRunning}"), ready: "[data-testid=mock-question-2]", setup: `document.querySelector("[data-testid=mock-question-2]").click()`, shows: "[data-testid=mock-run-examples]" },
	{ name: "Mock being taken, asking to end it", url: mockPage("{mockRunning}"), ready: "[data-testid=mock-end]", setup: `document.querySelector("[data-testid=mock-end]").click()`, shows: "[data-testid=mock-end-confirm]" },
	{ name: "Mock paused", url: mockPage("{mockPaused}"), ready: "[data-testid=mock-paused] [data-testid=mock-resume]" },
	{ name: "Mock graded", url: mockPage("{mockGraded}"), ready: "[data-testid=mock-results] [data-testid=mock-feedback]" },
	{ name: "Mock graded, an answer opened", url: mockPage("{mockGraded}"), ready: "[data-testid=mock-results] button[aria-expanded]", setup: `document.querySelector("[data-testid=mock-results] button[aria-expanded]").click()`, shows: "[data-testid=mock-results] .lh-collapse[data-state=open]" },
	{ name: "Home with Sounds on, Noise in the top bar", before: sounds(true), url: "/", ready: "[data-testid=app-bar] [data-testid=noise-word]" },
	{ name: "Mock ready to start, Noise in its bar", url: mockPage("{mockReady}"), ready: "[data-testid=mock-bar] [data-testid=noise-word]" },
	{
		name: "Home with Noise playing",
		url: "/",
		ready: "[data-testid=noise-word]",
		setup: `${unheard}; document.querySelector("[data-testid=noise-word]").click()`,
		shows: "[data-testid=noise-word][aria-pressed=true]",
	},
	// The two screens below leave requests the stand-in helper holds; the lesson that follows them ends them.
	{ name: "Cheat sheet being made", before: `${sounds(false)}; ${askSheet}`, url: sheetPage("{waitingDeadline}"), ready: "[data-testid=sheet-working]" },
	{ name: "Mock being written", before: askMock, url: "/space/deadline/{waitingDeadline}", ready: "[data-testid=deadline-mock-continue]", setup: `document.querySelector("[data-testid=deadline-mock-continue]").click()`, shows: "[data-testid=mock-writing]" },
	{ name: "Lesson whose first reply the teacher works on", before: dropAskedRequests, url: waitingLesson, ready: deskUp },
	// Stop is pressed at the first width; the widths after it open the lesson already stopped.
	{
		name: "Lesson whose first reply was stopped with nothing written",
		url: "/chat/{pending}",
		ready: `${turnRuns}, [data-testid=nothing-written]`,
		setup: `document.querySelector("${turnRuns}")?.click()`,
		shows: "[data-testid=nothing-written]",
	},
	// Start again runs that reply again. The stand-in helper, holding it, reads a file of its own and a passage of the space's: the desk lists
	// the steps and its sheet shows the file.
	{
		name: "Lesson whose reply the teacher works on, reading a file",
		url: "/chat/{pending}",
		ready: `${deskUp}, [data-testid=nothing-written]`,
		setup: `document.querySelector("[data-testid=nothing-written]") && document.querySelector("[data-testid=next-problem-button]")?.click(); ${whenThere(deskUp)}`,
		helper: "read",
		shows: "[data-testid=desk-paper][data-open]",
	},
	// The helper asks to run a command: its card, with the command on a slip, waits under the desk's steps for Deny or Allow.
	{
		name: "Lesson whose turn waits for the learner to allow a command",
		url: "/chat/{pending}",
		ready: deskUp,
		helper: "approve",
		shows: "[data-testid=desk-approvals] [data-testid=approval-subject]",
	},
	// Allow is pressed, so the card goes; the helper then writes the reply's first sentence and reads a file: the words over the desk's page, its
	// steps still on the writing row.
	{
		name: "Lesson whose reply is half written, its steps still there",
		url: "/chat/{pending}",
		ready: deskUp,
		setup: `${whenThere("[data-testid=approval-allow]")}; document.querySelector("[data-testid=approval-allow]")?.click(); for (let n = 0; n < 100 && document.querySelector("[data-testid=approval-card]"); n++) ${pause}`,
		helper: "stream",
		shows: `[data-turn-wrote] [data-testid=desk-paper], [data-turn-wrote] ${deskUp}`,
	},
	// The helper writes the reply's last sentence and ends the turn: the desk fades out and the text and the writing row are back in the middle.
	{
		name: "Lesson whose reply is finished",
		url: "/chat/{pending}",
		ready: "[data-turn-wrote]",
		helper: "finish",
		shows: "[data-testid=lesson-reading]:not([data-turn-wrote]) ~ *, [data-testid=next-problem-button]",
	},
	// The waiting lesson's held reply ends first, so the printed homework's held reply below is the only one the stand-in's desk requests reach.
	// A line sent beside the problem's page: the desk lists the steps on the writing row's side and lays no paper of its own.
	{
		name: "Homework lesson with a problem's page while the teacher works",
		before: `${dropWaitingLesson}\n${printedLine}`,
		url: "/chat/{homeworkPrinted}",
		ready: "[data-testid=page-piece] img",
		helper: "read",
		shows: `${deskUp} [data-testid=desk-plan] li`,
	},
	// It asks to run a command: its card waits under the desk's steps for Deny or Allow.
	{
		name: "Homework lesson with a problem's page, a card waiting",
		url: "/chat/{homeworkPrinted}",
		ready: "[data-testid=page-piece] img",
		helper: "approve",
		shows: "[data-testid=desk-approvals] [data-testid=approval-subject]",
	},
	// Allow is pressed; it writes the reply's first sentence and reads a file, so the desk comes back under the live words.
	{
		name: "Homework lesson with a problem's page, a reply being written",
		url: "/chat/{homeworkPrinted}",
		ready: "[data-testid=page-piece] img",
		setup: `${whenThere("[data-testid=approval-allow]")}; document.querySelector("[data-testid=approval-allow]")?.click(); for (let n = 0; n < 100 && document.querySelector("[data-testid=approval-card]"); n++) ${pause}`,
		helper: "stream",
		shows: `[data-turn-wrote] ${deskUp}`,
	},
	// That reply stopped, a line sent while the agent isn't logged in: the turn fails, and the writing row says why with the key that fixes it.
	// The panel chat's held reply below is then the only one the stand-in's desk requests reach.
	{
		name: "Homework lesson with a problem's page while the agent isn't logged in",
		agent: "signed-out",
		before: `${dropPrintedLine}\n${printedTurnEnded}\n${printedLine}`,
		url: "/chat/{homeworkPrinted}",
		ready: "[data-testid=page-piece] img",
		shows: "[data-testid=turn-row] [data-testid=agent-compact] [data-testid=agent-key]",
	},
	{
		name: "Teacher chat, all ideas",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${whenThere("[data-testid=talk-all-ideas]")}; document.querySelector("[data-testid=talk-all-ideas]").click()`,
		shows: "[data-testid=talk-try] [data-testid=talk-idea]",
	},
	// The longest starter: "Get me ready for" the deadline's name.
	{ name: "Teacher chat on a deadline", url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-when]", setup: openTeacher, shows: "[data-testid=talk-try] [data-testid=talk-starter]" },
	// The model key's menu opens up from the writing row, the stand-in's models listed.
	{
		name: "Teacher chat, its model list",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${whenThere("[data-testid=talk-model]")}; document.querySelector("[data-testid=talk-model]").click()`,
		shows: "[data-testid=talk-models] [data-testid=talk-model-choice]",
	},
	// Onboarding's mark: the panel opens by itself on Home, once.
	{
		name: "A new learner's first look at Home",
		before: `localStorage.setItem("lh:teacher-welcome", "1")`,
		url: "/",
		ready: deadlineCard,
		shows: "[data-testid=talk-try] [data-testid=talk-starter]",
	},
	// The stand-in helper answers a panel chat at once: the learner's plate, then the teacher's words.
	{ name: "Teacher chat with a reply", before: talk("What's due this week?"), url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=talk-thread] [data-testid=thread-teacher]" },
	// A message that asks for the slope checker is held: the desk lists the steps it reads under the newest plate.
	{
		name: "Teacher chat, a reply being written",
		before: talk(`Add Thursday's review session at 4 PM, and ${TALK_HOLDS} on problem 2 of homework 3`),
		url: "/",
		ready: deadlineCard,
		setup: openTeacher,
		helper: "read",
		shows: "[data-testid=talk-thread] [data-testid=desk-plan] li",
	},
	// The held reply asks to run a command: its card waits under the desk's steps for Deny or Allow.
	{ name: "Teacher chat, a card waiting", url: "/", ready: deadlineCard, setup: openTeacher, helper: "approve", shows: "[data-testid=talk-thread] [data-testid=approval-card]" },
	// Allow is pressed; the held reply writes its first sentence and reads a file: the words over the desk, whose steps stay.
	{
		name: "Teacher chat, the reply's words over its steps",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${whenThere("[data-testid=approval-allow]")}; document.querySelector("[data-testid=approval-allow]")?.click(); for (let n = 0; n < 100 && document.querySelector("[data-testid=approval-card]"); n++) ${pause}`,
		helper: "stream",
		shows: "[data-testid=talk-thread] [data-testid=thread-teacher] ~ * [data-testid=desk-plan] li",
	},
	// The line that gives way on a lesson has Stop while the chat's held reply runs.
	{ name: "Teacher's panel beside a lesson, Stop while the chat's reply runs", url: "/chat/{lesson}", ready: "[data-testid=cite-list]", setup: openTeacher, shows: "[data-testid=talk-gives-way] [data-testid=talk-stop]" },
	// The held reply is stopped: the chats, the one shown "open now".
	{
		name: "Teacher's chats under the Chats key",
		before: stopTalk,
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${whenThere("[data-testid=teacher-panel-chats]")}; document.querySelector("[data-testid=teacher-panel-chats]").click()`,
		shows: "[data-testid=teacher-panel-list] [data-testid=teacher-chat-open]",
	},
	// The chat's own window, and the main window's column while the shell says the window is open.
	{
		name: "The chat's own window",
		url: "/terminal-window",
		ready: "[data-testid=chat-window] [data-testid=teacher-panel-put-back]",
		shows: "[data-testid=chat-window] [data-testid=talk-chat]",
	},
	{
		name: "Teacher's column while the chat is in its window",
		url: "/",
		ready: deadlineCard,
		setup: `window.__lhPush("terminal-window", { open: true }); ${pause}; ${openTeacher}`,
		shows: "[data-testid=teacher-panel] [data-testid=teacher-panel-put-back]",
	},
	// A panel chat asks the stand-in teacher to update Lab Algebra: its round reads the space and searches the web, and Follow's slip says what it
	// does, at the foot of every page but a lesson's.
	{
		name: "Follow's slip while the teacher works",
		before: talk(TALK_ROUND),
		url: "/space/deadlines",
		ready: "[data-testid=deadline-open]",
		shows: "[data-testid=follow-slip] [data-testid=follow-slip-count]",
	},
	{ name: "Graph under Follow's slip", url: "/graph", ready: "[data-testid=graph-picture] [data-testid=graph-topic]", setup: fitsWindow, shows: "[data-testid=follow-slip]" },
	{
		name: "Graph, a topic picked, over Follow's slip",
		url: "/graph",
		ready: "[data-testid=graph-topic]",
		setup: `${pickTopic}; ${cameraRests(`picture().hasAttribute("data-near") && document.querySelector("[data-figure]")`)}; ${fitsWindow}`,
		shows: "body:has([data-testid=follow-slip]) [data-testid=graph-panel] [data-testid=topic-pane]",
	},
	// A screen opens in the narrowest window, where the open panel covers the page and the slip has no room: it is gone
	// once the panel is up, and back beside the panel in the wider windows.
	{ name: "Follow's slip beside the teacher's panel", url: "/", ready: deadlineCard, setup: openTeacher, shows: "body:not(:has([data-testid=follow-slip])) [data-testid=teacher-panel]" },
	// Its steps end with the web search, one of the agent's own tools.
	{
		name: "Follow's slip, its steps open",
		url: "/settings?section=connection",
		ready: "[data-testid=agent-status]",
		setup: `${whenThere("[data-testid=follow-slip-line]:not(:disabled)")}; document.querySelector("[data-testid=follow-slip-line]").click()`,
		shows: "[data-testid=follow-slip-list]",
	},
	// The stand-in adds a homework while the learner types: Follow waits, and the slip says so with the way there.
	{
		name: "Follow's slip, paused while you type",
		url: "/space/deadline/{deadline}",
		ready: "[data-testid=deadline-page] [data-testid=deadline-when]",
		setup: keepTyping,
		helper: "change",
		shows: "[data-testid=follow-slip] [data-testid=follow-slip-go]",
	},
	// The round ends while its list is open, so "Done" stays until the list shuts. Taking the homework away is a change on Home.
	{
		name: "Follow's slip, done with its steps open",
		url: "/",
		ready: deadlineCard,
		setup: `${whenThere("[data-testid=follow-slip-line]:not(:disabled)")}; document.querySelector("[data-testid=follow-slip-line]").click()`,
		helper: "done",
		shows: "[data-testid=follow-slip][data-mark=done] [data-testid=follow-slip-list]",
	},
	{ name: "Home with no deadline", before: `${roundEnded}\n${dropDeadlines}`, url: "/", ready: "[data-testid=today-empty]" },
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
	// The path space is open: its two facts are too few to sort into topics.
	{ name: "Graph, facts not sorted yet", url: "/graph", ready: "[data-testid=graph-picture] [data-testid=graph-sorts-next]", setup: fitsWindow },
	{ name: "Graph, a fact picked before any topic", url: "/graph", ready: "[data-testid=graph-picture] [data-testid=graph-loose]", setup: pickSquare, shows: "[data-testid=graph-panel] [data-testid=fact-pane]" },
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
	{ name: "Progress, a new space", before: newSpace, url: "/space", ready: "[data-testid=space-start] [data-testid=space-start-path]" },
	// With a lesson the new space is no longer empty: the deadline's place holds the two ways it still lacks.
	{ name: "Progress, a lesson but no deadline", before: lessonInNewSpace, url: "/space", ready: "[data-testid=next-deadline-none] [data-testid=space-start-path]" },
	{ name: "Files while the top bar asks about a missing deadline", before: gapSpace, url: "/space/files", ready: "[data-testid=gap-notice] [data-testid=gap-notice-update]" },
	{
		name: "Onboarding",
		before: `${dropGapSpace}; ${dropLateHomework}; const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, onboarded: false }) })${HTTP_OK}`,
		url: "/",
		ready: "[data-testid=onboarding-intro]",
	},
	{
		name: "Onboarding, Your teacher",
		url: "/",
		ready: "[data-testid=onboarding-start]",
		setup: `document.querySelector("[data-testid=onboarding-start]").click()`,
		shows: "[data-testid=agent-card] [data-testid=agent-model-select]",
	},
];
