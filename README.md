<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="godspeed" width="640">
  </picture>
</p>

<p align="center"><strong>A free, open-source AI tutor for your classes, taught by the AI you already pay for.</strong></p>

<p align="center">
  <a href="https://github.com/bayshores/godspeed/releases/latest"><strong>Download</strong></a> ·
  <a href="https://learnatgodspeed.com/">Website</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#outside-agents-mcp">Outside agents</a> ·
  <a href="docs/development.md">Docs</a> ·
  <a href="https://github.com/bayshores/godspeed/issues">Issues</a>
</p>

godspeed is a study app for students and self-learners. Claude Code, Codex or any MCP app becomes your tutor: it checks what you already know, plans a path to your goal or your next deadline, teaches one step at a time, then quizzes you. Every class gets its own lessons, files (PDFs, notes, lecture recordings), knowledge graph, deadlines and cheat sheets. It runs on Mac, Windows and Linux, and needs no API keys.

![A godspeed lesson: the teacher's explanation on the left, an open practice problem with a writing box on the right](docs/assets/lesson.png)

## How it works

![How godspeed works: you study in the godspeed app, your own agent teaches through MCP, and your data stays on your computer](docs/assets/how-godspeed-works.png)

<sub>The diagram is an Excalidraw file, [`docs/assets/how-godspeed-works.excalidraw`](docs/assets/how-godspeed-works.excalidraw). Open it at [excalidraw.com](https://excalidraw.com) to edit it.</sub>

1. **Measure.** The teacher finds where your understanding ends on each part the lesson depends on, from your answers, your confidence and what you type in the thinking box.
2. **Plan.** It maps the steps from there to your goal. The step bar shows where you are, and the plan changes when your answers say it should.
3. **Teach.** Each step builds on something you already understand. You predict, read the explanation, then check yourself. Confusions get fixed before anything is built on them.
4. **Practice.** Problems make you recall the right idea without being told which one it is.

Everything you learn is saved as facts and the reasoning chains between them, linked back to the lesson they came from. Later lessons read that graph instead of starting from zero.

## What's in it

- **Study.** One Study button starts a lesson for a topic, a homework method or a question you're stuck on. godspeed picks what to teach first and what to drill from how you've done so far. You can add pictures and PDFs to a message, and the teacher can ask you to write code in an editor.
- **Classes.** Each class has its own lessons, files, knowledge graph, deadlines and cheat sheets. Add PDFs, Word and PowerPoint files, notes, code, transcripts and lecture recordings (transcribed on your computer with whisper.cpp), or link a folder that's rescanned every minute. Google Drive folders work too.
- **Home and deadlines.** Add exams, homework, quizzes and projects with a date, an optional time and the files they cover. Home shows what's coming up and how ready you are for each one.

![Home: the deadlines coming up in each class with how ready you are, and a card for each class](docs/assets/home.png)

- **Knowledge graph.** A topic map. Your agent groups facts into topics, colors each by how often you get it right, and draws arrows for "learn this first". Pick a deadline to see the days left and what to work on next.

![The Graph: topics colored by how often you get them right, with arrows for what to learn first, and the Midterm's days left and what to work on next](docs/assets/graph.png)

- **Overview.** How ready you are for each deadline, how each lesson went, and whether your confidence matches your results (five levels, from guessing to certain).

![A class Overview: readiness for each deadline, how lessons went, and a confidence check](docs/assets/overview.png)

- **Cheat sheets.** Your agent makes a PDF cheat sheet for a deadline. Tell it what to change in the chat beside the sheet, point at the part you mean, and the rules you give it stick for that sheet. The sheet can also sit beside a lesson.

![A cheat sheet for the Midterm with the chat that made it and the rules it keeps](docs/assets/cheat-sheet.png)

- **Talk.** Ask your agent to set up classes, add deadlines or answer questions about your classes from the panel in the corner.

## Get started

Download godspeed for your computer:

- **[Mac with an Apple chip (M1 or newer)](https://github.com/bayshores/godspeed/releases/latest/download/godspeed-mac-apple-silicon.dmg):** open the file, then drag godspeed into Applications.
- **[Windows](https://github.com/bayshores/godspeed/releases/latest/download/godspeed-windows-x64-setup.exe):** open the file. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. (The app isn't signed on Windows.)
- **Linux:** [AppImage](https://github.com/bayshores/godspeed/releases/latest/download/godspeed-linux-x64.AppImage) (most computers) or [.deb](https://github.com/bayshores/godspeed/releases/latest/download/godspeed-linux-x64.deb) (Ubuntu, Debian). Make the AppImage executable, then open it.

Each link downloads the newest version directly.

The app checks for updates once a day and installs them when you quit. **Settings → General → Check for updates** checks right away.

The first launch walks you through connecting your agent (below). You can find the same steps later under **Settings → Connection**.

To build it yourself instead: `npm install`, then `npm run desktop:local` (an unsigned Mac app in `dist/`), or `node scripts/fetch-model.mjs` once and then `npm run dev` (http://localhost:3000).

## Outside agents (MCP)

While godspeed is open it runs an MCP server, and an agent you already use is its teacher. The agent also does the background jobs: research, diagrams, PDF reading and building your knowledge graph. If no agent is teaching, that work waits and starts when one does. An agent can be connected without teaching; the sidebar and **Settings → Connection** say so and tell you how to start it.

1. Click **Open Claude Code** (the arrow next to it switches to **Codex**). godspeed makes a folder for your agent, `~/godspeed`, and opens a terminal there running it. The folder holds the agent's instructions (`CLAUDE.md`, `AGENTS.md`) and its connection to the app, so godspeed only loads when you study, not in your other chats. You can also run the command yourself: **Copy the command** copies it. In Claude Code, `/setup-classes` builds your classes from your course files.
   - **Other MCP apps:** pick **Other app** for the address and token (Streamable HTTP, `Authorization: Bearer <token>`).
2. Start a lesson. You answer in the godspeed window and the agent teaches.

While you think, Claude Code waits in a background script, so the agent spends no tokens until you answer. Agents can also list and read lessons, search your graph and your class files, import notes, and manage classes and deadlines. They can save short notes about you (like "the midterm is over"), and every agent sees those notes and where you left off when it connects. You can see and delete the notes under **Settings → Connection**. Only programs on your computer that hold the token can connect.

## Your plans, your data

- The AI is your own agent, on the plan you already pay for. godspeed has no subscription or markup of its own.
- Lessons, graphs, class files and settings stay on your machine as plain files you can read.
- Each task sends the context it needs to your agent, and web research fetches pages. Local storage doesn't mean offline.
- System prompts are visible and editable.

## Development

```bash
npm run check        # typecheck + tests + lint + dead-code check (knip): what CI runs
npm test             # tests only. deterministic: no LLM, no network
```

A change is done when `npm run check` passes.

The code is split in `src/`: `frontend/` is what the browser runs, `backend/` is the server, the agent loops and the files on disk, and `shared/` is the pure logic both use. `src/app/` holds the Next.js pages and API routes. Tests mirror that split under `tests/`.

See the [development guide](docs/development.md) and [architecture](docs/architecture.md). Bugs and requests go to [GitHub Issues](https://github.com/bayshores/godspeed/issues).

## License

[AGPL-3.0](LICENSE). godspeed started as a fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist, keeps its teaching method, and is distributed under the same license.
