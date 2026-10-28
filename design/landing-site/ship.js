// "Built in the open": latest release, recent commits and stars, read live
// from GitHub (falls back to the numbers from Oct 28, 2026), plus the
// daily commit bars.

const REPO = "bayshores/godspeed";

const FALLBACK = {
	stars: 4,
	tag: "v0.4.0",
	date: "2026-10-27T22:47:35Z",
	assets: [
		["godspeed-0.4.0-arm64.dmg", 163],
		["godspeed-0.4.0-x64-setup.exe", 161],
		["godspeed-0.4.0-x86_64.AppImage", 180],
		["godspeed-0.4.0-amd64.deb", 138],
	],
	commits: [
		["2026-10-28T02:15:00Z", "outside agent: lesson waits also take background jobs; dock says when no agent is listening"],
		["2026-10-27T22:34:00Z", "files: one panel per section, drag to add or move, clearer status"],
		["2026-10-27T22:20:00Z", "tidy: move app code into src/, designs into docs/, packaging into electron/"],
		["2026-10-27T22:01:00Z", "ci: faster release and CI"],
		["2026-10-27T21:56:00Z", "release 0.4.0: sign with the godspeed Apple team, download link in README"],
		["2026-10-27T21:06:00Z", "redesign: lesson layout B, class overview, topic graph, and a faster app"],
		["2026-10-27T08:37:00Z", "typography: Source Sans chrome, shaded bold, mono only for numbers"],
		["2026-10-27T04:30:00Z", "motion, outside-agent fixes, and a zero-token teaching wait"],
	],
};

// Commits per day, Aug 21 to Oct 28 (LearnHarness upstream included).
const DAILY = "2026-08-21:1 2026-08-22:41 2026-08-29:1 2026-08-31:9 2026-09-01:17 2026-09-02:23 2026-09-05:12 2026-09-08:12 2026-09-09:20 2026-09-11:24 2026-09-12:15 2026-09-13:37 2026-09-14:43 2026-09-15:15 2026-09-16:3 2026-09-17:30 2026-09-18:11 2026-09-19:34 2026-09-20:1 2026-09-22:18 2026-09-23:29 2026-09-24:21 2026-09-25:21 2026-09-26:15 2026-09-27:12 2026-09-28:9 2026-09-29:30 2026-09-30:20 2026-10-01:1 2026-10-02:26 2026-10-03:7 2026-10-04:19 2026-10-05:35 2026-10-06:18 2026-10-07:14 2026-10-08:11 2026-10-09:4 2026-10-10:9 2026-10-11:5 2026-10-12:1 2026-10-13:9 2026-10-16:5 2026-10-17:5 2026-10-20:4 2026-10-21:4 2026-10-23:11 2026-10-24:22 2026-10-25:15 2026-10-26:19 2026-10-27:11";

const OS_ICON = {
	mac: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.9-4.2zM13.9 5.2c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z"/></svg>',
	win: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5.5l7.5-1v7H3zm8.5-1.2L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zm8.5 0H21V21l-9.5-1.3z"/></svg>',
	linux: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 3c-2.2 0-3.4 1.8-3.4 4.4 0 2-.8 3.1-1.9 4.6C5.4 13.7 4.6 16 6 18c1.3 1.8 3.6 2.6 6 2.6s4.7-.8 6-2.6c1.4-2 .6-4.3-.7-6-1.1-1.5-1.9-2.6-1.9-4.6C15.4 4.8 14.2 3 12 3z"/></svg>',
};
const dl = '<svg viewBox="0 0 24 24" style="color:#8d8d8d"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 4v11m-5-5l5 5 5-5M5 20h14"/></svg>';

const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtWhen = (iso) => {
	const d = new Date(iso);
	return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};
const ago = (iso) => {
	const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
	return `${Math.round(h / 24)} days ago`;
};

function render(d) {
	document.getElementById("stars").textContent = d.stars;
	document.getElementById("relDate").textContent = fmtDate(d.date);
	const v = document.getElementById("version");
	v.setAttribute("aria-label", d.tag);
	// Each character is a column of characters that rolls up to its final one.
	v.innerHTML = [...d.tag]
		.map((ch) => {
			const digits = /\d/.test(ch) ? Array.from({ length: 6 }, (_, k) => (Number(ch) + 10 - 5 + k) % 10).concat([ch]) : [ch];
			return `<span class="col">${digits.map((x) => `<span>${x}</span>`).join("")}</span>`;
		})
		.join("");
	document.getElementById("assets").innerHTML = d.assets
		.map(([n, mb]) => {
			const os = /dmg|mac/.test(n) ? "mac" : /exe/.test(n) ? "win" : "linux";
			return `<li>${OS_ICON[os]}<span>${n}</span><span class="sz">${mb} MB</span>${dl}</li>`;
		})
		.join("");
	document.getElementById("commits").innerHTML = d.commits
		.map(([when, msg], i) => {
			const [scope, ...rest] = msg.split(": ");
			const body = rest.length ? `<b>${scope}</b><span>${rest.join(": ")}</span>` : `<span>${msg}</span>`;
			return `<li style="opacity:${i < 6 ? 1 : i === 6 ? 0.5 : 0.25}"><time>${fmtWhen(when)}</time><div>${body}</div></li>`;
		})
		.join("");
	document.getElementById("updated").textContent = `updated ${ago(d.commits[0][0])}`;
}

export function buildBars() {
	const counts = Object.fromEntries(DAILY.split(" ").map((s) => s.split(":")).map(([k, v]) => [k, +v]));
	const bars = document.getElementById("bars");
	const max = 43;
	for (let t = Date.UTC(2026, 7, 21); t <= Date.UTC(2026, 9, 28); t += 864e5) {
		const day = new Date(t).toISOString().slice(0, 10);
		const c = counts[day] || 0;
		const i = document.createElement("i");
		i.style.height = `${Math.max(2, (c / max) * 100)}%`;
		i.style.background = c ? (day >= "2026-10-26" ? "#fff" : `rgba(255,255,255,${0.16 + (c / max) * 0.48})`) : "#1a1a1a";
		i.title = `${day}: ${c} commit${c === 1 ? "" : "s"}`;
		bars.appendChild(i);
	}
}

export async function loadShip() {
	render(FALLBACK);
	try {
		const get = (p) => fetch(`https://api.github.com/repos/${REPO}${p}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
		const [repo, rel, commits] = await Promise.all([get(""), get("/releases/latest"), get("/commits?per_page=8")]);
		render({
			stars: repo.stargazers_count,
			tag: rel.tag_name,
			date: rel.published_at,
			assets: rel.assets.filter((a) => /\.(dmg|exe|AppImage|deb)$/.test(a.name)).map((a) => [a.name, Math.floor(a.size / 1048576)]),
			commits: commits.map((c) => [c.commit.author.date, c.commit.message.split("\n")[0]]),
		});
		return true;
	} catch {
		return false;
	}
}
