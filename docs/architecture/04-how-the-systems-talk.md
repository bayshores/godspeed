## 4. How the systems talk

Each system writes only its own store. Three protocols connect them:

- Turn request: window posts one input event to Classroom (§5).
- Ack-and-steer: a job tool answers at once, Workbench runs job, result returns into lesson (§5.1).
- Extraction trigger: Classroom tells Library to read new teacher prose (§6).

Study, practice and homework are lesson kinds inside the Classroom, not separate systems (§7). Every lesson reads its own graph through one read-only tool, `search_graph` (§6). A study lesson also starts with the picked facts and their chains in a `[Session context]` note and its topics in a `[Study plan]` note (§7).

```mermaid
flowchart TB
    LEARNER["the learner"]

    subgraph STAGE["Stage: the window (writes nothing on the server)"]
        UI["Home, space pages, lesson screen, Graph page, teacher panel"]
    end

    subgraph CLASSROOM["Classroom: writes data/chats"]
        TURN["turn pipeline: handle_chat_input"]
        AGENTS["lesson agent, rebuilt from the record each turn"]
        CHATS[("data/chats/*.json")]
    end

    subgraph WORKBENCH["Workbench: writes data/jobs"]
        RUNNER["job runner: researcher, demo-builder, visual-maker, pdf-reader"]
        WAKE["wake pipeline: one queue per lesson, in memory"]
    end

    subgraph LIBRARY["Library: writes the graph ledgers"]
        EXTRACT["extraction: extractor, then merger"]
        TOPICS["topic grouper"]
        DERIVE["derivation: snapshot and progress, read only"]
        LEDGERS[("graph ledgers")]
    end

    OUTSIDE["outside agent over MCP"]

    LEARNER -->|"messages, answers"| UI
    UI -->|"POST /api/chat, one input event"| TURN
    TURN --> AGENTS
    TURN -->|"question calls stream as SSE"| UI
    TURN -->|"save_messages, persist_turn"| CHATS
    TURN -->|"job tool: ack now, run in background"| RUNNER
    RUNNER -->|"result as a steer message"| WAKE
    WAKE -->|"steer the live turn, or fire a wake turn"| TURN
    TURN -->|"trigger_extraction"| EXTRACT
    EXTRACT -->|"reads teacher prose"| CHATS
    EXTRACT -->|"appends facts and chains"| LEDGERS
    EXTRACT -->|"run ended"| TOPICS
    TOPICS -->|"appends topics.jsonl"| LEDGERS
    DERIVE -->|"reads"| LEDGERS
    UI -->|"GET /api/graph, GET /api/progress"| DERIVE
    AGENTS -.->|"work items"| OUTSIDE
    RUNNER -.->|"work items"| OUTSIDE
    EXTRACT -.->|"work items"| OUTSIDE
```
