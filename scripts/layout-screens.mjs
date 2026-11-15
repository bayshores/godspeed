/**
 * layout-screens.mjs — the screens `npm run layout` checks, in order, each at every width.
 *
 * A screen opens at `url`, waits for `ready`, runs `setup` in the page (clicks), then waits for
 * `shows`. `ready` and `shows` name something drawn from the screen's data, not its frame, so the
 * check never runs on a screen still loading. `before` runs in the page first, on the screen
 * before it, for a change of data; it stays for the screens after it. `{space}`, `{lesson}` and
 * `{deadline}` are the made-up data's ids (layout-seed.mjs). Scripts may await.
 */

export const WIDTHS = [1440, 1100, 800];

/** After a fetch in the page: an HTTP error throws, so a setup that failed is not walked past. */
export const HTTP_OK = `.then((r) => { if (!r.ok) throw new Error(r.url + " answered " + r.status); return r; })`;

const openTeacher = `document.querySelector("[data-testid=bar-teacher]").click()`;
const deadlineCard = "[data-teacher-target='deadline:{deadline}']";

export const SCREENS = [
	{ name: "Today with a deadline", url: "/", ready: deadlineCard },
	{ name: "Progress", url: "/space", ready: "[data-testid=next-deadline-open]" },
	{ name: "Lessons", url: "/space/lessons", ready: "[data-testid=lessons-list] [data-testid^=session-row]" },
	{ name: "Files", url: "/space/files", ready: "[data-testid=files-list] > *" },
	{ name: "Graph", url: "/graph", ready: "[data-testid=fact-row], [data-testid=topic-row]" },
	{ name: "Cheat sheets", url: "/space/cheat-sheets", ready: "[data-testid=cheat-sheet-card]" },
	{ name: "Deadlines", url: "/space/deadlines", ready: "[data-testid=deadline-open]" },
	{ name: "Deadline", url: "/space/deadline/{deadline}", ready: "[data-testid=deadline-page] [data-testid=deadline-name]" },
	{ name: "Lesson with a sourced reply, an open quiz and the plan", url: "/chat/{lesson}", ready: "[data-testid=cite-list]" },
	{ name: "Teacher's panel with no agent", url: "/", ready: deadlineCard, setup: openTeacher, shows: "[data-testid=terminal-none] [data-testid=open-agent]" },
	{ name: "Teacher's Activity", url: "/", ready: deadlineCard, setup: `${openTeacher}; await new Promise((done) => setTimeout(done, 100)); document.querySelector("[data-testid=teacher-panel-view]").click()`, shows: "[data-testid=activity-list] > *" },
	{ name: "Settings, Connection", url: "/settings?section=connection", ready: "[data-testid=agent-status]" },
	{ name: "Settings, Teaching", url: "/settings?section=teaching", ready: "[data-testid^=area-][data-testid$=-instructions]:not(:disabled)" },
	{ name: "Settings, Appearance", url: "/settings?section=appearance", ready: "[data-testid=appearance-preview]" },
	{ name: "Settings, General", url: "/settings?section=general", ready: "[data-testid=teacher-name-row]" },
	{
		name: "The agent's screen",
		url: "/",
		ready: deadlineCard,
		setup: `${openTeacher}; await new Promise((done) => setTimeout(done, 100)); document.querySelector("[data-testid=open-agent]").click()`,
		shows: "[data-testid=terminal-stop]",
	},
	{ name: "Today with no deadline", before: `await fetch("/api/spaces/{space}/deadlines/{deadline}", { method: "DELETE" })${HTTP_OK}`, url: "/", ready: "[data-testid=today-empty]" },
	{
		name: "Onboarding",
		before: `const { settings } = await fetch("/api/settings")${HTTP_OK}.then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, onboarded: false }) })${HTTP_OK}`,
		url: "/",
		ready: "[data-testid=onboarding-intro]",
	},
];
