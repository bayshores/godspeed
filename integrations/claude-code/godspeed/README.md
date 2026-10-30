# godspeed for Claude Code

I made godspeed because I was using Claude to study for CSE 21 and it kept going in circles. I'd get stuck on a counting problem, work through it with Claude, and ten days later get stuck on basically the same problem in a new chat that had no idea we'd done this before. I'd even written a tutoring skill so it would give hints instead of answers. Didn't matter much. Every chat started from zero.

So godspeed saves all of that outside the chat. It's a desktop app (Mac, Windows, Linux) that keeps your lessons, your answers, how sure you were on each one, and a graph of what you know for each class. This plugin lets Claude Code teach from all of it. Claude isn't required, though. Codex and any other agent that supports MCP can connect to the same app.

It uses the plan you already pay for. No API keys anywhere.

## Before you start

Download godspeed from [learnatgodspeed.com](https://learnatgodspeed.com) and open it. The plugin talks to the app on your own computer, so the app has to be running.

Then install the plugin in Claude Code.

```
/plugin install godspeed --marketplace bayshores/godspeed
```

## Commands

- `/godspeed:teach` picks up the lesson you were on. Add a topic to start a new one, like `/godspeed:teach conditional probability`.
- `/godspeed:setup-classes` builds your classes from your course files.

## How it connects

The plugin runs a small local bridge (`scripts/connect.mjs`) that passes requests to the godspeed app at 127.0.0.1. It reads the app's access token from the app's data folder and sends nothing to any other server. While you're thinking about an answer, a background script waits for you, so Claude doesn't spend tokens until you reply. And when Claude Code shortens its memory in a long session, a small hook tells the app, so the next message comes with the whole lesson again.

## License

AGPL-3.0. godspeed is a fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist.
