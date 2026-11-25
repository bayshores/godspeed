## 12. The seam directory

Each seam is the one place a future change should touch.

| Seam | Where | Swaps |
|---|---|---|
| Storage | `Stores::new` in `crates/store` (called by `App::new`) | stores, once |
| The learner's agent | `gs_runtime` (`Runtime`), `services::app::agents` | which agent program runs lessons and jobs, and how godspeed speaks to it |
| Background jobs | `agent::subagents::job_agent` (`JobAgent`), `services::jobs::job_agent` | where and when a job's session runs |
| Turn composition | `services::turns::chat_handler` | what a turn consists of |
| Extraction trigger | `services::turns::turn_service` (`trigger_extraction`) | when Library runs |
| Outside-agent boundary | `server::mcp` (tools, access check), `services::app::terminal_state` | what an agent in godspeed's terminal or outside it can do |
| Teacher's graph access | `agent::tools::graph` (`search_graph`), filled in by `services::turns::lesson_setup` | what teacher can read of graph |
| Steer delivery | `services::jobs` (`deliver_job_result`, `set_turn_runner`, `set_job_respawn`) | how background results re-enter lessons |
| Push events | `Events` in `crates/base`, `server::http::events`, `src/frontend/components/server-events.tsx`; vocabulary in `src/shared/core/events.ts` | change notification, end to end |
| Agent construction | `AgentBuildOptions` in `agent::teacher::teacher_agent` | scripted engines and tool registries in tests |
| Sub-agent checks | `agent::subagents::headless` (`get_headless`) | demo and SVG checks through shell's web view, or none |
| Access gate | `server::http::access` | who may call `/api` |
| Data location | `LH_DATA_DIR` (`gs_base::config`, `Paths`) | where `data/` lives |
| Desktop host | `crates/shell`, talking to server through `crates/shell-rpc` | launcher and security shell |
