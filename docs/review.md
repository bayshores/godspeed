# Review before landing

The brief for the agent that reads a branch before it lands on `main`. The checks in [checks.md](checks.md) already passed, so the review looks only for the mess no check can see.

The reviewer is a fresh agent: one that did not write the change and was not told what the writer thinks of it. The writer starts one and hands it this file and nothing else.

## Steps

1. Find where the branch left `main`: `git merge-base HEAD origin/main`.
2. Read the change: `git diff <that commit>..HEAD`. Read each changed file whole where the diff alone does not show what the code around it does.
3. Read the reasons the branch gave for growing a list of exceptions: `git log --format=%B <that commit>..HEAD | grep '^Ratchet:'`. Judge each one by the table below.
4. For each kind in the table, look for it in the change. Search the repo before calling something a second copy or a second way (`graphify query "<question>"`, then grep).
5. Answer in the form under "The answer". Change no file.

## What to look for

| Kind | What it looks like | What to ask |
|---|---|---|
| Over-built | A function called from one place that only passes its arguments on. An option, parameter or type that only one caller sets. A hook "for later". Hand-written code where the repo has a helper that does the job. | Does the approved change need this? Is there a second real use today? |
| One rule, decided twice | Two pieces of code that look different and answer the same question, such as "which lesson owns this list" or "may this tool be offered". They agree today and drift apart later. | Where else is this decided? Can this code ask that place? |
| A fact worked out again | A screen or a caller that computes, guesses or hard-codes what the service or the store already knows: a limit, a count, a status, a threshold. | Who owns this fact? Can it be sent or read instead? |
| The same data kept twice | A second record, cache or piece of state that holds what another already holds, with code that keeps the two in step (an event, a copy on save, a second id). | What breaks when the two disagree? Can one of them be read from the other? |
| A second way | A new way to do something the repo already has one way for: loading, saving, sending, waiting, logging, naming a path. | What does the existing way lack? If nothing, use it. If something, change it for everyone. |
| Leftovers | Part of a replaced thing that still has a user and so passes the dead code checks: an old event still sent, a field still written and never read, a fallback to the old way, a style or a doc line for what is gone. | Was the old thing removed whole in this change? |
| Two jobs in one file | A file that both decides and draws, or both stores and formats, or a function with two unrelated halves. The size check only sees the largest files. | Can each half be named in a few words? Then it is two files or two functions. |
| A failure nobody sees | A result dropped through a local helper or a closure, an error turned into an empty value, a task whose end nobody waits for, a default returned where the data was damaged. The patterns of the dropped-write check miss these. | Who learns that this failed: the learner, the log, or nobody? |
| A name that drifts | A new word for a thing the app already names, in the UI, a tool, a type or a test. | What does the rest of the app call this? |
| A comment that is wrong | A comment that names real things and says something false, or tells what the code does and not why. The comment check only knows whether the names exist. | Is it true? Would the code be less clear without it? |
| A check dodged | A copy changed slightly so the copy check passes. A name added to a list of exceptions, or a `Ratchet:` line, whose reason would fit any change. An `#[expect]` whose reason restates the lint. A test weakened so it passes. | Would the reason still hold for the next agent who wants the same exception? |

## Not the reviewer's job

- What a check already enforces (the rows of "What each check stops" in [checks.md](checks.md)).
- Formatting, and wording that is a matter of taste.
- The design the owner approved: what the feature does, how it looks, what it is called on screen.
- Code the change did not touch, unless the change adds a second copy of it.

## The answer

One block for each finding, the worst first:

- **Where:** `path/to/file:line`.
- **Kind:** a name from the table.
- **What:** one or two sentences on what is wrong, with the other place it clashes with when there is one.
- **Fix:** the smallest change that removes it.

When nothing is found, the answer is the one line "Nothing found", with the number of files read. A finding the reviewer is unsure of is still reported and says so.

## What the writer does with it

1. Fix each finding, or answer it in a sentence when it is wrong.
2. A finding of a kind a check could see becomes a check in the same change (steps in [checks.md](checks.md), "Adding a check").
3. Tell the owner, in the report of the change, what the review found and what was done about each finding.
