<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="godspeed" width="640">
  </picture>
</p>

<p align="center"><strong>An agent harness for learning.</strong></p>

<p align="center">
  <a href="https://github.com/bayshores/godspeed">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/development.md">Documentation</a> ·
  <a href="https://github.com/bayshores/godspeed/issues">Issues</a>
</p>

godspeed is a fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist. It adds outside-agent teaching: Claude Code, Codex, or any MCP app can be your teacher, running on your own plan. It removes API keys entirely.

godspeed uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason. That picture is updated as you learn.

Instead of just giving you an explanation, it uses your answers and thinking to decide what you need next. Teaching builds understanding one reasoning step at a time. Practice makes it usable. A persistent knowledge graph carries it across sessions.

![godspeed teaching session](docs/assets/teaching-session.png)

## How it works

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them. The aim is for the goal to feel obviously true, not merely familiar.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

**Think out loud.** The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words. This is how the agent gets a detailed picture rather than just a record of right and wrong answers. You type your answers.

The agent can also research questions in the background, create visual explanations, and build interactive demonstrations.

## Knowledge that carries forward

What you are taught accumulates as propositions and reasoning chains: individual claims and the premises that lead to them. The graph shows this structure, with links back to the source sessions. You can also import notes.

Future teaching sessions can read the graph instead of starting from scratch. Practice sessions can draw their material from it. It stores the ideas and their connections, not ratings of your ability.

![godspeed knowledge graph](docs/assets/knowledge-graph.png)

## Get started

Build and run it from source (see [Development](#development-and-support)). Then either:

- **Sign in to a subscription** (ChatGPT, GitHub Copilot, or Grok) under Settings → Providers and choose your models, or
- **Let an outside agent teach you** (below).

There are no API keys to paste.

## Outside agents (MCP)

godspeed runs an MCP server while it is open, so an agent you already use can act as its AI: the teacher in lessons, and optionally the worker behind its helpers and its knowledge-graph builder.

1. In godspeed, open **Settings → Outside agents** and turn on access.
2. Connect your agent:
   - **Claude Code:** `/plugin marketplace add bayshores/godspeed`, then `/plugin install godspeed@godspeed`, then run `/godspeed:teach` (add a topic to start a new lesson).
   - **Codex:** paste the config snippet shown in that settings screen into `~/.codex/config.toml`.
   - **Other MCP apps:** use the address and access token shown there (Streamable HTTP, `Authorization: Bearer <token>`).
3. Pick **Outside agent (MCP)** as a lesson's model (or for the helper and graph models in Settings → Agent). You read and answer in the godspeed window; the agent teaches.

Agents can also list and read your lessons, search your knowledge graph, and import notes. Only programs on your computer that have the token can connect.

## Your plans, your data

- **Your plans and models.** No godspeed subscription or markup. Models run on your own subscriptions or your own agent.
- **Local storage.** Your chats, graph, settings, and sign-ins live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your signed-in subscriptions. Model requests send the context needed for the task; web research also fetches pages from the internet. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable. The app is open source under the AGPL-3.0 license.

## Development and support

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md), [architecture](docs/architecture.md), and [desktop release guide](docs/desktop-release.md).

Questions, bug reports, and feature requests: [GitHub Issues](https://github.com/bayshores/godspeed/issues).

## License

[AGPL-3.0](LICENSE)

godspeed is based on LearnHarness, copyright its authors, and is distributed under the same AGPL-3.0 license.
