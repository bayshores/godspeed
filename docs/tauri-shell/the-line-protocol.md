## The line protocol

One JSON object per line, UTF-8, ending `\n`. Field `t` names the message. The server speaks it only when `LH_SHELL=1`.

| Direction | Message | Meaning |
|---|---|---|
| server to shell | `{"t":"ready"}` | Listening. Sent once, right after the bind. |
| shell to server | `{"t":"login","id":n,"token":"<64 hex>"}` | Accept this one-time login token; expires after 60 s by the app clock. |
| server to shell | `{"t":"login_ok","id":n}` | Stored. The shell opens the login URL only after this. |
| server to shell | `{"t":"demo","id":n,"html":"…","probe":"…"\|null}` | Run a demo. |
| server to shell | `{"t":"svg","id":n,"svg":"…","width":w,"height":h}` | Snapshot an SVG resvg could not draw. |
| server to shell | `{"t":"notify","id":n,"title":"…","body":"…"}` | Show a system notification (a deadline reminder). |
| shell to server | `{"t":"demo_done","id":n,"result":{"consoleErrors":[],"pageErrors":[],"failedRequests":[],"probeResult":…,"ok":true}}` or `{"t":"demo_done","id":n,"error":"…"}` | `probeResult` absent when no probe ran. |
| shell to server | `{"t":"svg_done","id":n,"png":"<base64>"}` or `{"t":"svg_done","id":n,"error":"…"}` | A PNG of exactly w × h px. |
| shell to server | `{"t":"notify_done","id":n,"shown":true\|false}` | False while the main window has focus, or when the plugin refused. |
| shell to server | `{"t":"terminals","live":["<32 hex>",…],"teacher":"<32 hex>"\|null}` | Ids of running agent terminals, and the teacher's among them. Sent after every start, Stop and end, in order, and again once a restarted server is ready. |
| shell to server | `{"t":"typed","terminal":"<32 hex>"}` | The learner sent the agent in that terminal a message: Enter on its own while the screen showed no question. |
| shell to server | `{"t":"agent_folder","id":n}` | Where is the godspeed folder? Asked at every terminal start. |
| server to shell | `{"t":"agent_folder","id":n,"folder":"…"\|null}` | The folder in use, or `null` while not set up. The shell waits 2 s. |
| server to shell | `{"t":"clear_line","terminal":"<32 hex>","line":"…"}` | The learner's line went to a lesson or cheat sheet page. In Claude Code's teacher terminal, the shell clears that line from the agent's input box within 3 s. |
| server to shell | `{"t":"nudge","terminal":"<32 hex>","line":"…"}` | The quiet teacher has work waiting. The shell types the line into the teacher's input and sends it (see [While it runs](terminals.md#while-it-runs)). |
| server to shell | `{"t":"show_window","page":"<app path>?space=<id or none>"}` | The agent opened a page. The shell brings the window forward and sends a window that has not loaded to that page. |
| server to shell | `{"t":"menu_bar_countdown","title":"3d"\|null,"rows":[{"text":"Quiz 2 is tomorrow","page":"/space/deadline/<id>?space=<id>"},…]}` | Mac only. Show the menu bar item, made the first time: the title beside the logo (none shows the logo alone) and a menu row for each deadline. Sent at the start and each time the words change. |
| server to shell | `{"t":"menu_bar_countdown_off"}` | Mac only. The setting is off: remove the menu bar item. |

- Unknown lines are logged to stderr and skipped on both sides.
- stdin EOF stops the server, on every OS.
- The server waits at most 60 s for an answer, then fails with `demo check timed out`.
- An answer for a server that has since died is dropped. A restarted server starts a new id space.
