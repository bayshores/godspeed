## Terminals

The learner's agents (Claude Code or Codex) run in terminals the shell owns and shows in the window. `crates/shell/src/terminal/` keeps them in memory only: at most one live record per role (teacher, helper), each with a 32-hex id. An ended record keeps its screen until the next start for its role.

### Starting one

1. The page names a role and an agent, and for the teacher maybe an earlier chat to go back to. The shell asks the server for the godspeed folder (`agent_folder`) and builds the rest, so the page never names a program, argument or folder. The chat must be a UUID (`gs_base::ids::is_uuid`); the script passes it on, unquoted on Windows.
2. The script must be `<folder>/.godspeed/start-<agent>[-helper].<command|cmd|sh>`, written by the server: a plain file in a plain `.godspeed` folder, neither a link. A link, a missing script or a folder not set up answers "The godspeed folder isn't set up yet."
3. It runs through the learner's login shell, as Terminal does with a `.command` file, so PATH from `.zprofile` and `.zshrc` both count: `<shell> -l -i -c 'exec "$0"' <script>`. `<shell>` is `$SHELL` when zsh, bash, sh, dash or ksh, else `/bin/zsh` (Mac) or `/bin/bash` (Linux). Windows runs `%ComSpec% /d /c .godspeed\<script name>` in the folder: portable-pty quotes only spaces, and cmd would split a full path at `&`, `(`, `)` or `^`.
4. `portable-pty` opens an 80 × 30 pseudo-terminal (ConPTY on Windows). The page showing it then sizes it to its screen (`terminal_resize`): the pseudo-terminal and the shell's `vt100` screen resize together, and the agent redraws.

| Environment | Value |
|---|---|
| Base | The app's own, minus `LH_*`, `TAURI_*` and, on Linux, the AppImage variables (`APPDIR`, `APPIMAGE`, `ARGV0`, `OWD`, `LD_LIBRARY_PATH`, `LD_PRELOAD`, `GDK_PIXBUF_MODULE_FILE`, `GIO_EXTRA_MODULES`, `GSETTINGS_SCHEMA_DIR`, `GTK_PATH`, `GTK_EXE_PREFIX`, `GTK_DATA_PREFIX`). |
| `TERM`, `COLORTERM`, `LANG` | `xterm-256color`, `truecolor`, `en_US.UTF-8`, each only when unset. |
| `GODSPEED_TERMINAL` | The terminal's id. The folder's connector and waiter send it as header `x-godspeed-terminal` (only a 32 lowercase hex value); Codex forwards it to the connector through `env_vars`. |
| `GODSPEED_DATA_DIR` | This app's data folder, so the agent finds this app's `mcp-endpoint.json` and token. |
| `GODSPEED_RESUME` | The teacher's chat to go back to, only when the page picked one. The app's own value of each `GODSPEED_` variable here is dropped first. |
| `Path` (Windows) | System and account values from the registry, so an agent installed after godspeed opened is found. Only both together replace the app's own. |

### Which window shows it

A terminal is attached to at most one window, by label: `main`, or `terminal` (the pop-out). The windows' labels are named once, in `window.rs`.

| What | Rule |
|---|---|
| Attach from a window | That window now shows the terminal. It gets a snapshot of the screen, then every `terminal-output`, and no other window does. A window that showed it before is replaced without a message. |
| Detach from a window | Stops output only when that window is the attached one. A page that unmounts after another window took over changes nothing. |
| Typing, paste, "Try asking" lines, Attach | Accepted from the attached window only. All but Attach also need that window to have focus. Any other window gets "Show the terminal and click in it first." |
| `terminal-state` | Goes to every window that exists, since a window that shows nothing yet must still learn that a terminal ended or asks a question. |
| A window destroyed | Every terminal it showed is detached (`Terminals::window_closed`), so nothing is sent to it and no window may type until one attaches. |
| Resize, answer, stop, list | Not tied to a window. |

While the terminal window is open the main page mounts no view of the teacher's terminal (`TerminalsApi.popped`, [the terminal window](the-main-window.md#the-terminal-window)), so the two windows never fight over its output. Background work's terminal stays in the main window.

The shell's `Outlet::push` takes a `To`: `To::Window(label)` for output and snapshots, `To::All` for state.

### While it runs

Four threads per terminal: output, input, exit, and a clock that sleeps until it has work, so an idle or hidden terminal never wakes the app.

- **Output** goes through a `vt100` screen (1000 lines of scrollback) and, only while attached, to the window that attached as `terminal-output` 16 ms after the first waiting byte. More than 64 KB in one frame goes as a screen snapshot, so a program printing without pause can't hold up the window. If drawing the output panics, the shell stops the terminal, keeps reading and dropping output, and the screen says "godspeed couldn't read this terminal's screen, so it stopped it." with `ended` `{stopped: false, code: null}`. The shell answers the questions a program asks its terminal (cursor position, device attributes, status), because a hidden terminal has no page and ConPTY waits for the cursor position before the program starts; the page's own answers are dropped.
- **Input** is queued and written in order on its own thread, so a terminal that reads nothing never holds the window up. `terminal_write`, `terminal_answer` and `terminal_paste` run without `async`, keeping key order. `terminal_add_file` and `terminal_send` run off the main thread (see Attach and Send), so a key typed meanwhile can land before what they type.
- **Typing** (`write`, `paste`, `send`) is refused unless that terminal is attached to the calling window and that window has focus. Paste drops escape characters and is bracketed when the program asked for bracketed paste. When the learner presses Enter on its own (not with Alt or Shift, not in a paste) while the shell sees no question on screen, the server hears `typed`. The trust and Enter buttons write through `answer`, so never count.
- **Attach** (`add_file`) takes only the teacher's terminal attached to the calling window, but not focus: a file dropped from Finder arrives while Finder still has it. Safe, because it types only a path the shell saved itself and refuses a path with a line break. It runs off the main thread, refuses a file over 20 MB from the base64 text's length before decoding, checks the first bytes (PNG, JPEG, GIF, WebP, PDF), writes `<folder>/.godspeed/attachments/<first 12 hex of the SHA-256>-<name>` (the name's last part, characters other than letters, digits, `.`, `-` and `_` as `_`), and types the path as a Finder drag does (a backslash before a space or a character a shell reads; on Windows in quotes when it has a space) and a space, bracketed when the program asked, no Enter. Right before typing it looks again: a terminal hidden or ended while the file was saved gets nothing, and a copy this attach made is removed.
- **Clear line** (`clear_line`, Claude Code's teacher only): a line the learner typed that went to a lesson or cheat sheet page. For up to 3 s the shell waits for the input box to show that line, then deletes it (`clear_input`).
- **Nudge** (`nudge`, teacher only): the server's line for a quiet teacher. Each second for a minute, while no question shows, the shell types it, reads the input box back after 300 ms, and sends Enter only when the box holds exactly that line; otherwise it deletes what it typed. It never counts as `typed`.
- **Send** (`send`, teacher only): a line from the "Try asking" row or the list of everything the teacher can do. Refused while a question shows, for a line with a control character, and for an ended terminal. The shell types the line once the way Nudge does (read back after 300 ms, Enter only when the input holds exactly that line, else deleted again, so it never sends what the learner had typed there) and answers "Clear what you typed in the terminal, then try again." when it did not send. A sent line counts as `typed`, as the learner's own Enter does.
- **The clock** sends waiting output and pushes `terminal-state` when the recognised question or the web address on screen changes. It wakes only for output to send or a question reaching its 2 s, else sleeps until output comes or the terminal ends.

### What the shell recognises

Matched by shape, since agents reword their screens. Screen text is only matched, never run, logged or stored past the next start.

| `prompt` | Shape |
|---|---|
| `"trust"` | Claude Code's trust question, matched whole: an unnumbered "No, exit" row with a blank row above it, "Yes, I trust this folder" right under it, exactly one of them behind a pointer, and below them only "Enter to confirm · Esc to cancel"; the last line with a `?` in the 8 rows above starts with "Is this a project you created or one you trust?" (after any bullet and "Quick safety check:"). Anything else gets no button, Codex's trust screen and every permission menu too, whatever its command, reason or diff says. |
| `"menu"` | Numbered rows from 1 up, at least two, exactly one highlighted (a pointer such as `❯` or `›` before it, or inverse video). |
| `"enter"` | One of the last three lines opens with "Press Enter", or a sentence in it does. |

A question counts once unchanged for 2 s. `url` is true while the screen shows an `http` or `https` address. The trust and Enter buttons send keys only if the shell sees that question on screen at that moment. Trust on "No" sends Down, then Enter once the shell sees the pointer on "Yes" (within 1 s); if the screen changed, nothing more.

### The panel opens and closes by itself

`teacher/panel-auto-model.ts` decides, `teacher/use-teacher-panel.ts` applies it. A need is `needsYou` for the teacher's or background work's terminal.

| Rule | What happens |
|---|---|
| A need arises (none before) while the panel is closed | The panel opens on that terminal's screen without taking the keyboard. A need already there when the learner closed the panel does not reopen it. |
| The learner is writing | A key in a writing box (text box, text field or editable element, not the terminal's screen) in the last 3 s holds the opening back until 3 s after the last key, if the need and the closed panel are still there. |
| The need is settled | The panel closes, but only one that opened by itself and that the learner has not opened since. |
| A lesson reply starts (the open lesson's `working` goes from false to true) with no need present | The panel closes, whoever opened it. A lesson already working when it first reports is no change. |
| The teacher's terminal is popped out | The panel closes when it pops out, never opens by itself, and the need is not kept. The strip lights instead. |

Size and dock are untouched, and the first terminal list after a reload is a start, not a change. Without a motion preference the panel hangs down from the bar; with reduced motion it appears and goes at once (`.lh-hang-body`).

### Stop, quit and the server

| Event | What happens |
|---|---|
| Stop | Record marked stopping; the server hears the new live set at once. Mac and Linux send SIGHUP to the script's process group (`portable-pty` makes it a session leader, `rustix` sends the signal), then SIGKILL 2 s later; Windows ends the Job Object. |
| The script exits | `ended` is `{stopped: false, code}`; whatever it left running is hung up and killed the same way. Exit 3 means agent not found, 4 Node.js missing. A failed exit whose screen says "No conversation found with session ID" (Claude Code) or "No saved session found" (Codex) becomes 5: the chat to go back to is gone. |
| The teacher ends | However it ended (Stop, exit, crash), the shell stops the helper as above. The page may be gone by then, so it doesn't do this itself. |
| Quit | `quit.rs` stops every terminal before the server: all hang up at once (one already stopping too), and after 2 s every group is killed, also what a script that ended in the last 2 s left. A group is signalled no more once killed, since its pid may then belong to another program. |
| Server crash | Terminals live on. The restarted server gets `LH_TERMINALS`, and the reloaded page calls `terminal_list`. |
| A child that left the group | It still sends the ended id, so the server refuses it. On Windows the job holds it unless it breaks away. |

The Job Object has kill-on-close and takes the script right after it starts, so closing the app kills the tree too.

Server side: `refuse()` in `crates/server/src/mcp/mod.rs` answers 403 `{"error": "This terminal was closed in godspeed."}` to a request whose terminal id is not live (no header means an agent outside the app). `Bridge::set_live_terminals` wakes every waiter, a wait of an ended terminal ends with the same error, and items that terminal claimed go back at once instead of after the 10 minute hold. After `typed` (`Bridge::typed`, live terminals only), that terminal's wait, or its next one within 2 minutes, ends at once and claims nothing. When that wait is the teacher terminal's, the agent counts as teaching for 3 minutes ([architecture/08.1.2-the-work-loop.md](../architecture/08.1.2-the-work-loop.md#the-work-loop)).
