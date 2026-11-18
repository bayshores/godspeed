<p align="center">
  <img src="docs/assets/banner.png" alt="godspeed, in alpha" width="640">
</p>

<h3 align="center">The AI agent you already use teaches you, and godspeed remembers where you got stuck.</h3>

<p align="center">A free, open-source study app. It runs on the Claude or ChatGPT plan you already pay for, with no API keys.</p>

<p align="center"><b>godspeed is in alpha. Things change fast between updates.</b></p>

<p align="center">
  <a href="https://github.com/bayshores/godspeed/releases/latest/download/godspeed-mac-apple-silicon.dmg"><img src="https://img.shields.io/badge/Mac_(Apple_chip)-c9c6bb?style=for-the-badge" alt="Download for Mac with an Apple chip"></a>
  <a href="https://github.com/bayshores/godspeed/releases/latest/download/godspeed-mac-intel.dmg"><img src="https://img.shields.io/badge/Mac_(Intel)-c9c6bb?style=for-the-badge" alt="Download for Mac with an Intel chip"></a>
  <a href="https://github.com/bayshores/godspeed/releases/latest/download/godspeed-windows-x64-setup.exe"><img src="https://img.shields.io/badge/Windows-c9c6bb?style=for-the-badge" alt="Download for Windows"></a>
  <a href="https://github.com/bayshores/godspeed/releases/latest/download/godspeed-linux-x64.AppImage"><img src="https://img.shields.io/badge/Linux-c9c6bb?style=for-the-badge" alt="Download for Linux"></a>
</p>

<p align="center">
  <a href="https://learnatgodspeed.com/">Website</a>&emsp;
  <a href="#how-it-works">How it works</a>&emsp;
  <a href="#get-started">Get started</a>&emsp;
  <a href="docs/development.md">Docs</a>&emsp;
  <a href="https://github.com/bayshores/godspeed/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/bayshores/godspeed/releases/latest"><img src="https://img.shields.io/github/v/release/bayshores/godspeed?label=version&color=b85c57" alt="Latest version"></a>
  <img src="https://img.shields.io/badge/stage-alpha-b85c57" alt="Stage: alpha">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-b85c57" alt="License AGPL-3.0"></a>
  <a href="https://m8ven.ai/mcp/bayshores-godspeed-1epilf?s=readme"><img src="https://m8ven.ai/badge/mcp/bayshores-godspeed-1epilf" alt="M8ven Score"></a>
</p>

<p align="center">
  <img src="docs/assets/lesson.gif" alt="One topic of a godspeed lesson: Today says what to study next, the teacher explains and quotes the lecture, a quiz is answered right, a sentence is kept, and the lesson stops at the end of the topic" width="1000">
</p>

<p align="center"><sub>Recorded in the app on a made-up machine learning space. The teacher's replies are replayed from a real lesson, so a live agent takes longer to answer.</sub></p>

## Why I made it

I was using Claude to study for discrete math and it kept going in circles. I'd get stuck on a counting problem, work through it with Claude, and then ten days later I'd get stuck on basically the same problem in a new chat that had no idea we'd already done this. I even wrote a tutoring skill so it would give me hints instead of answers, but that didn't really help because every new chat still knew nothing about me.

So godspeed keeps all of that outside the chat. It saves your lessons, your answers, how sure you were on each one and a graph of what you know, and whatever agent you use (Claude Code, Codex or anything else with MCP) teaches from that.

## What a lesson looks like

The GIF up top is one topic of a lesson, and it goes like this.

1. Today tells you what to study next, and one button starts it.
2. The teacher explains a step at a time and quotes your own lecture.
3. You answer and say how sure you are.
4. If you get it right the teacher can give you one sentence to keep, and it shows up again later.
5. Every topic ends at a stopping point, so you can quit there and pick it back up from Today.

Questions from older lessons come back when they're due, and godspeed asks and grades those itself without calling your agent.

## What's in it

| Part | What it does |
| --- | --- |
| Spaces | One for each thing you study, like a course, a certification or a language. Each has its own lessons, files, graph, deadlines and cheat sheets. |
| Files | PDFs, Word and PowerPoint files, EPUB books, notes, code, transcripts and lecture recordings. Or link a folder, Google Drive works too. |
| Deadlines | Exams, homework, quizzes, projects and interviews. Today shows the next one big, with a button to start studying for it, and the week ahead as seven day columns with a Later column after them. |
| Paths | No syllabus? Tell your agent your goal, like "I want to become a backend developer", and it writes a path of topics in order. Study takes the next one you haven't got down yet. |
| Knowledge graph | What you've learned, grouped into topics and colored by how often you get it right. |
| Progress | How ready you are for each deadline, and whether your confidence matches your results. |
| Homework | Attach the assignment and the teacher goes through it one problem at a time. It gives you hints but never the answer. |
| Mocks | Take a mock on any exam, quiz or interview deadline, timed or not. |
| Cheat sheets | Your agent makes a PDF cheat sheet for a deadline, and you tell it what to change. |
| Plugins | Small add-ons for a lesson or a space, like one that turns the question you're on into a meme. A plugin can't open your files. Add one in Settings or [make your own](docs/plugins.md). They're new, so how they work can still change. |
| Calculator | End a calculation with `=` in any box and the answer shows up in grey. It does algebra, derivatives and integrals too. |
| Your agent's screen | Click your teacher's name in the top bar to open it. You can ask your agent to set up spaces or add deadlines there. |

## How it works

![How godspeed works: you study in the godspeed app, your own agent teaches through MCP, and your data stays on your computer](docs/assets/how-godspeed-works.png)

The teacher figures out where your understanding stops, from your answers and how sure you were. It plans the steps from there to your next deadline, and each step builds on something you already get. You predict, read the explanation, then check yourself. After that you get problems where you have to pick the right idea on your own.

What you learn is saved as facts linked back to the lesson they came from, so the next lesson can build on them.

## Get started

Download it with the buttons at the top, and it updates itself after that.

- Mac needs macOS 14 or newer.
- Windows will say "Windows protected your PC" because the app isn't signed there. Click **More info**, then **Run anyway**.
- Linux also has a [.deb](https://github.com/bayshores/godspeed/releases/latest/download/godspeed-linux-x64.deb) for Ubuntu 22.04 or newer and Debian 12 or newer.

Open it and click **Start Claude Code**, or pick Codex under **Use another agent**. godspeed runs your agent inside the app in its own `~/godspeed` folder, so it stays out of your other chats, and then you can start a lesson.

Any other MCP app works too, and **Other app** shows the address and token (Streamable HTTP, `Authorization: Bearer <token>`).

<details>
<summary>More on how the agent connects</summary>

<br>

- While godspeed is open it runs an MCP server on your computer. Only programs on your computer that hold the token can connect.
- While you think, Claude Code waits in a background script, so it spends no tokens until you answer.
- A second session of your agent reads your files and builds the graph in the background, so the teacher stays free for you.
- **Change command** under **Settings → Connection** sets what godspeed runs instead of `claude` or `codex`.
- In Claude Code, `/setup-spaces` builds your spaces from your course files.
- Agents can save short notes about you (like "the midterm is over") so the next one knows. You can see and delete them under **Settings → Connection**.

</details>

## Your data

- It's your own agent on your own plan, so godspeed has no subscription or markup of its own.
- Your lessons, graphs, files and settings stay on your computer as plain files you can read.
- It isn't offline though, since your agent gets the context it needs for each task and web research fetches pages.
- If you paste a Tavily key in Settings, your search words go to Tavily. Otherwise your agent uses its own web search.
- The system prompts are visible and you can edit them.

## Development

```bash
npm install
node scripts/fetch-model.mjs   # once
npm run dev                    # http://localhost:3000
npm run check                  # everything CI runs
```

`src/` is the React screens and `crates/` is the Rust server and the Tauri shell. The [development guide](docs/development.md) and [architecture](docs/architecture/README.md) have the rest. Bugs and requests go to [Issues](https://github.com/bayshores/godspeed/issues).

## License

[AGPL-3.0](LICENSE). godspeed started as a fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist, keeps its teaching method, and is under the same license.
