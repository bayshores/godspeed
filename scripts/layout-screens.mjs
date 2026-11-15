/**
 * layout-screens.mjs — the screens `npm run layout` checks, in order, each at every width.
 *
 * A screen opens at `url`, waits for `ready`, runs `setup` in the page (clicks), then waits for
 * `shows`. `before` runs in the page first, on the screen before it, for a change of data; it
 * stays for the screens after it. `{space}`, `{lesson}` and `{deadline}` are the made-up data's
 * ids (layout-seed.mjs). Scripts may await.
 */

export const WIDTHS = [1440, 1100, 800];

const openTeacher = `document.querySelector("[data-testid=bar-teacher]").click()`;

export const SCREENS = [
	{ name: "Today with a deadline", url: "/", ready: "[data-testid=bar-teacher]" },
	{ name: "Progress", url: "/space", ready: "[data-testid=nav-progress]" },
	{ name: "Lessons", url: "/space/lessons", ready: "[data-testid=nav-lessons]" },
	{ name: "Files", url: "/space/files", ready: "[data-testid=nav-files]" },
	{ name: "Graph", url: "/graph", ready: "[data-testid=nav-graph]" },
	{ name: "Cheat sheets", url: "/space/cheat-sheets", ready: "[data-testid=nav-cheat-sheets]" },
	{ name: "Deadlines", url: "/space/deadlines", ready: "[data-testid=nav-deadlines]" },
	{ name: "Deadline", url: "/space/deadline/{deadline}", ready: "main" },
	{ name: "Lesson with a sourced reply, an open quiz and the plan", url: "/chat/{lesson}", ready: "[data-testid=cite-list]" },
	{ name: "Talk with a sourced reply and no agent", url: "/", ready: "[data-testid=bar-teacher]", setup: openTeacher, shows: "[data-testid=talk-teacher] [data-testid=cite-list]" },
	{ name: "Activity", url: "/", ready: "[data-testid=bar-teacher]", setup: `${openTeacher}; await new Promise((done) => setTimeout(done, 100)); document.querySelector("[data-testid=teacher-tab-activity]").click()`, shows: "[data-testid=activity-list]" },
	{ name: "Settings, Connection", url: "/settings?section=connection", ready: "[data-testid=settings-content] > *" },
	{ name: "Settings, Teaching", url: "/settings?section=teaching", ready: "[data-testid=settings-content] > *" },
	{ name: "Settings, Appearance", url: "/settings?section=appearance", ready: "[data-testid=settings-content] > *" },
	{ name: "Settings, General", url: "/settings?section=general", ready: "[data-testid=settings-content] > *" },
	{ name: "Talk empty", before: `await fetch("/api/talk", { method: "DELETE" })`, url: "/", ready: "[data-testid=bar-teacher]", setup: openTeacher, shows: "[data-testid=talk-empty]" },
	{ name: "Today with no deadline", before: `await fetch("/api/spaces/{space}/deadlines/{deadline}", { method: "DELETE" })`, url: "/", ready: "[data-testid=bar-teacher]" },
	{
		name: "Onboarding",
		before: `const { settings } = await fetch("/api/settings").then((r) => r.json()); await fetch("/api/settings/general", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...settings.general, onboarded: false }) })`,
		url: "/",
		ready: "[data-testid=onboarding-intro]",
	},
];
