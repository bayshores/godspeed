/**
 * layout-screens.mjs — the screens `npm run layout` checks, in order, each at every width.
 *
 * A screen opens at `url`, waits for `ready`, runs `setup` in the page (clicks), then waits for
 * `shows`. `ready` and `shows` name something drawn from the screen's data, not its frame, so the
 * check never runs on a screen still loading. `before` runs in the page first, on the screen
 * before it, for a change of data; it stays for the screens after it. `{space}`, `{lesson}`,
 * `{deadline}`, `{homeworkOpen}`, `{homeworkFirst}`, `{homeworkMany}`, `{homeworkOpenDeadline}` and `{pathSpace}` are the made-up data's ids (layout-seed.mjs). Scripts may await.
 */

export const WIDTHS = [1440, 1100, 800];

/** After a fetch in the page: an HTTP error throws, so a setup that failed is not walked past. */
export const HTTP_OK = `.then((r) => { if (!r.ok) throw new Error(r.url + " answered " + r.status); return r; })`;

const pause = `await new Promise((done) => setTimeout(done, 100))`;
const openTeacher = `document.querySelector("[data-testid=live-pill]").click()`;
const deadlineCard = "[data-teacher-target='deadline:{deadline}']";
/** Today's every group at once: the next deadline, three more this week, one ticked done, two
 *  later. Dates count from the day the check runs. */
const busyDay = `const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv");
const base = "/api/spaces/{space}/deadlines";
const add = (kind, name, n, time) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, name, date: day(n), time, fileIds: [] }) })${HTTP_OK};
await add("exam", "Graphing quiz", 2, "10:00");
await add("homework", "Homework 7: slopes", 3);
await add("project", "Spring-loaded graph project", 5, "23:00");
await add("homework", "Warm-up problems", 6);
await add("homework", "Polynomial practice", 4);
await add("exam", "Final exam, everything", 20, "09:00");
await add("quiz", "Quiz 3: graphing systems", 12);
const { deadlines } = await fetch("/api/deadlines")${HTTP_OK}.then((r) => r.json());
const done = deadlines.find((d) => d.name === "Polynomial practice");
await fetch(base + "/" + done.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: true }) })${HTTP_OK};`;

/** A homework due yesterday, so the overdue card asks about it. */
const lateHomework = `const day = new Date(Date.now() - 86400000).toLocaleDateString("sv");
await fetch("/api/spaces/{space}/deadlines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "homework", name: "Graphing worksheet, part 2", date: day, fileIds: [] }) })${HTTP_OK};`;
/** Takes that homework away again, so the screens after it are as before. */
const dropLateHomework = `const { deadlines } = await fetch("/api/deadlines")${HTTP_OK}.then((r) => r.json());
const late = deadlines.find((d) => d.name === "Graphing worksheet, part 2");
if (late) await fetch("/api/spaces/{space}/deadlines/" + late.id, { method: "DELETE" })${HTTP_OK};`;

/** The homework with a problem open covers the made-up file, as the exam does not. */
const homeworkCoversFile = `const { space } = await fetch("/api/spaces/{space}")${HTTP_OK}.then((r) => r.json());
await fetch("/api/spaces/{space}/deadlines/{homeworkOpenDeadline}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileIds: [space.files[0].id] }) })${HTTP_OK};`;
/** The homework comes before the quiz, so it is Progress's next deadline. */
const homeworkTomorrow = `const day = new Date(Date.now() + 86_400_000);
const date = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
await fetch("/api/spaces/{space}/deadlines/{homeworkOpenDeadline}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ date }) })${HTTP_OK};`;
/** Every deadline the seed made, so Today has none. */
const dropDeadlines = ["{deadline}", "{homeworkOpenDeadline}", "{homeworkFirstDeadline}", "{homeworkManyDeadline}"].map((id) => `await fetch("/api/spaces/{space}/deadlines/${id}", { method: "DELETE" })${HTTP_OK};`).join("\n");

/** The other two homework deadlines cover the file too, so the Graph's deadline pane has a list to pick from. */
const moreHomeworkCoversFile = `const { space } = await fetch("/api/spaces/{space}")${HTTP_OK}.then((r) => r.json());
for (const id of ["{homeworkFirstDeadline}", "{homeworkManyDeadline}"]) await fetch("/api/spaces/{space}/deadlines/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileIds: [space.files[0].id] }) })${HTTP_OK};`;
/** A folder that is always there and always empty, linked to the second space. */
const linkedFolder = `await fetch("/api/spaces/{pathSpace}/folder", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/private/var/empty" }) })${HTTP_OK};`;
/** The second space closed, so the plus list has a closed space; the first is the open one again. */
const closedSpace = `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json());
await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, activeSpace: "{space}" }) })${HTTP_OK};
await fetch("/api/spaces/{pathSpace}", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ closed: true }) })${HTTP_OK};`;
/** A right-click on the element the expression `el` finds. */
const rightClick = (el) => `{ const el = ${el}; const at = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.left + 10, clientY: at.top + 10 })); }`;

/** The work frame with its tag, whether the work waits for an agent or the window started a
 *  stand-in helper for it. */
const waitingFrame = "[data-testid=work-frame] [data-testid=work-frame-tag]";
/** A file added to the space with no agent to read it, so every tab of the space is framed. It
 *  can't be removed while it waits, so the stand-in agent started later takes it. */
const waitingFile = `const form = new FormData();
form.append("kind", "study");
form.append("files", new File(["# Slopes\\n\\nRise over run."], "waiting-notes.md", { type: "text/markdown" }));
await fetch("/api/spaces/{space}/files", { method: "POST", body: form })${HTTP_OK};`;
/** The deadline asks for a study guide with no agent to make it. The deadline is deleted for
 *  "Today with no deadline", which ends the request. */
const waitingRequest = `await fetch("/api/spaces/{space}/deadlines/{deadline}/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "guide" }) })${HTTP_OK};`;

export const SCREENS = [
	{ name: "Today with a deadline", url: "/", ready: deadlineCard },
	{ name: "Today, the Add deadline menu", url: "/", ready: "[data-testid=home-add-deadline][aria-haspopup=menu]", setup: `document.querySelector("[data-testid=home-add-deadline]").click()`, shows: "[data-testid=home-add-deadline-menu][data-state=open]" },
	{ name: "Today, the Menu list", url: "/", ready: deadlineCard, setup: `document.querySelector("[data-testid=app-menu]").click()`, shows: "[data-testid=app-menu-list][data-state=open]" },
	{ name: "Today, the plus list", url: "/", ready: deadlineCard, setup: `document.querySelector("[data-testid=spaces-plus]").click()`, shows: "[data-testid=spaces-plus-list][data-state=open]" },
	{ name: "Today, a space tab's menu", url: "/", ready: deadlineCard, setup: rightClick(`document.querySelector("[data-testid=space-option-{space}]")`), shows: "[data-testid=space-menu][data-state=open]" },
	{ name: "Progress", url: "/space", ready: "[data-testid=next-deadline-open]" },
	{ name: "Lessons", url: "/space/lessons", ready: "[data-testid=lessons-list] [data-testid^=session-row]" },
	{ name: "Lessons, a lesson's menu", url: "/space/lessons", ready: "[data-testid=lessons-list] [data-testid=session-row-menu]", setup: `document.querySelector("[data-testid=session-row-menu]").click()`, shows: "[data-testid=session-context-menu][data-state=open]" },
	{ name: "Files", url: "/space/files", ready: "[data-testid=files-list] > *" },
	{ name: "Files, the Add files menu", url: "/space/files", ready: "[data-testid=space-add-files]:not(:disabled)", setup: `document.querySelector("[data-testid=space-add-files]").click()`, shows: "[data-testid=space-add-files-menu][data-state=open]" },
	{ name: "Files, a file's menu", url: "/space/files", ready: "[data-testid=files-list] button[aria-label^='More for']", setup: `document.querySelector("[data-testid=files-list] button[aria-label^='More for']").click()`, shows: "[data-testid^=space-file-menu-body-][data-state=open]" },
	{ name: "Graph", url: "/graph", ready: "[data-testid=fact-row], [data-testid=topic-row]" },
	{ name: "Graph, costs open", url: "/graph", ready: "[data-testid=graph-costs]", setup: `document.querySelector("[data-testid=graph-costs]").click()`, shows: "[data-testid=graph-costs-panel][data-state=open]" },
	{
		name: "Graph, costs open beside the docked panel",
		url: "/graph",
		ready: "[data-testid=graph-costs]",
		// The page is narrowest here: the panel takes its room.
		setup: `localStorage.setItem("lh:pane-height:teacher", "full"); ${openTeacher}; ${pause}; localStorage.removeItem("lh:pane-height:teacher"); ${pause}; ${pause}; ${pause}; document.querySelector("[data-testid=graph-costs]").click()`,
		shows: "[data-testid=graph-costs-panel][data-state=open]",
	},
	{
		name: "Graph, a fact's menu",
		url: "/graph",
		ready: "[data-testid=topic-row]",
		setup: `[...document.querySelectorAll("[data-testid=topic-row]")].find((row) => !/, 0 facts/.test(row.getAttribute("aria-label"))).click(); ${pause}; ${rightClick(`document.querySelector("[data-testid=topic-pane] [data-testid=fact-row]")`)}`,
		shows: "[data-testid=fact-context-menu][data-state=open]",
	},
	{ name: "Deadlines", url: "/space/deadlines", ready: "[data-testid=deadline-open]" },
	{ name: "Deadline", url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-name]" },
	{ name: "Homework deadline with its two keys", url: "/space/deadline/{homeworkOpenDeadline}", ready: "[data-testid=homework-card] [data-testid=deadline-work]" },
	// The Graph's card shows a deadline that covers files, so the homework covers the made-up one.
	{ name: "Graph with a homework on top", before: homeworkCoversFile, url: "/graph", ready: "[data-testid=deadline-pane] [data-testid=deadline-work]" },
	{ name: "Progress with a homework next", before: homeworkTomorrow, url: "/space", ready: "[data-testid=next-deadline] [data-testid=deadline-work]" },
	{ name: "Graph, the deadline list", before: moreHomeworkCoversFile, url: "/graph", ready: "[data-testid=deadline-picker][aria-haspopup=menu]", setup: `document.querySelector("[data-testid=deadline-picker]").click()`, shows: "[data-testid=deadline-picker-menu][data-state=open]" },
	{ name: "Lesson with a sourced reply, an open quiz and the plan", url: "/chat/{lesson}", ready: "[data-testid=cite-list]" },
	{ name: "Lesson with a plugin's page open", url: "/chat/{lesson}", ready: "[data-testid=lesson-plugin-flashcards]", setup: `document.querySelector("[data-testid=lesson-plugin-flashcards]").click()`, shows: "[data-testid=plugin-window] [data-testid=plugin-frame][data-state=ready]" },
	{ name: "Homework lesson with an open problem", url: "/chat/{homeworkOpen}", ready: "[data-testid=open-problem]" },
	{ name: "Homework lesson before a problem opens", url: "/chat/{homeworkFirst}", ready: "[data-testid=next-problem-button]" },
	{ name: "Homework lesson with fourteen problems, the first done", url: "/chat/{homeworkMany}", ready: "[data-testid=plan-step][data-status=done] [data-testid=problem-pick]" },
	{ name: "Space's plugin tab", url: "/space/plugin/flashcards", ready: "[data-testid=plugin-frame][data-state=ready]" },
	{ name: "Teacher's window with no agent", url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Teacher's window, the other agents", url: "/", ready: deadlineCard, setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=open-agent-menu]").click()`, shows: "[data-testid=open-agent-choices][data-state=open]" },
	{
		name: "Teacher's panel docked beside a lesson",
		url: "/chat/{lesson}",
		ready: "[data-testid=cite-list]",
		// The height it opens at is read once, as it opens.
		setup: `localStorage.setItem("lh:pane-height:teacher", "full"); ${openTeacher}; ${pause}; localStorage.removeItem("lh:pane-height:teacher")`,
		shows: "[data-testid=terminal-none] [data-testid=open-agent]",
	},
	{ name: "Teacher's Activity", url: "/", ready: deadlineCard, setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=teacher-panel-activity]").click()`, shows: "[data-testid=teacher-panel-list] [data-testid=activity-list] > *" },
	{ name: "Settings, Connection", url: "/settings?section=connection", ready: "[data-testid=agent-status]" },
	{ name: "Settings, Teaching", url: "/settings?section=teaching", ready: "[data-testid^=area-][data-testid$=-instructions]:not(:disabled)" },
	{ name: "Settings, Plugins", url: "/settings?section=plugins", ready: "[data-testid=plugins-list]" },
	{ name: "Settings, Plugins, Add", url: "/settings?section=plugins", ready: "[data-testid=plugins-add][data-opens=sheet]", setup: `document.querySelector("[data-testid=plugins-add]").click()`, shows: "[data-testid=plugins-add-sheet] [data-testid=plugins-listed-meme-cards]" },
	{ name: "Settings, Appearance", url: "/settings?section=appearance", ready: "[data-testid=appearance-preview]" },
	{ name: "Settings, Appearance, the font list", url: "/settings?section=appearance", ready: "[data-testid=font-trigger]", setup: `document.querySelector("[data-testid=font-trigger]").click()`, shows: "[data-testid=font-menu][data-state=open] [data-testid=font-option-default]" },
	{ name: "Settings, General", url: "/settings?section=general", ready: "[data-testid=teacher-name-row]" },
	{ name: "Progress while a file waits for an agent", before: waitingFile, url: "/space", ready: waitingFrame },
	{ name: "Graph while a file waits for an agent", url: "/graph", ready: waitingFrame },
	{ name: "Deadline while its request waits for an agent", before: waitingRequest, url: "/space/deadline/{deadline}", ready: waitingFrame },
	{
		name: "The agent's screen",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; ${pause}; document.querySelector("[data-testid=open-agent]").click()`,
		shows: "[data-testid=terminal-starters] [data-testid=terminal-starter]",
	},
	// The longest starter key: "Get me ready for" the deadline's name.
	{ name: "The agent's screen on a deadline", url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-name]", setup: openTeacher, shows: "[data-testid=terminal-starters] [data-testid=terminal-starter]" },
	{ name: "Today with no deadline", before: dropDeadlines, url: "/", ready: "[data-testid=today-empty]" },
	{ name: "Today on a busy day", before: busyDay, url: "/", ready: "[data-testid=today-list] [data-testid^=today-done-row]", shows: "[data-testid=later-list]" },
	{ name: "Today with the overdue card", before: lateHomework, url: "/", ready: "[data-testid=overdue-notice] [data-testid=overdue-notice-done]" },
	{
		name: "Progress with a path, all shown",
		before: `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, activeSpace: "{pathSpace}" }) })${HTTP_OK}`,
		url: "/space",
		ready: "[data-testid=space-path-show-all]",
		setup: `document.querySelector("[data-testid=space-path-show-all]").click()`,
		shows: "[data-testid=space-path-rows] li:nth-child(7)",
	},
	{ name: "Files, the linked folder's box", before: linkedFolder, url: "/space/files", ready: "[data-testid=space-folder]", setup: `document.querySelector("[data-testid=space-folder]").click()`, shows: "[data-testid=space-folder-box][data-state=open]" },
	{ name: "The plus list with a closed space", before: closedSpace, url: "/", ready: "[data-testid=spaces-plus]", setup: `document.querySelector("[data-testid=spaces-plus]").click()`, shows: "[data-testid=spaces-plus-list][data-state=open] [data-testid=closed-space-{pathSpace}]" },
	{ name: "A closed space's menu", url: "/", ready: "[data-testid=spaces-plus]", setup: `document.querySelector("[data-testid=spaces-plus]").click(); ${pause}; ${rightClick(`document.querySelector("[data-testid=closed-space-{pathSpace}]")`)}`, shows: "[data-testid=space-menu][data-state=open]" },
	{
		name: "Onboarding",
		before: `${dropLateHomework}; const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, onboarded: false }) })${HTTP_OK}`,
		url: "/",
		ready: "[data-testid=onboarding-intro]",
	},
];
