# Feature: text-agents

Branch: `feat/text-agents` (from `main`). Delivery: work-unit commits, native review per unit,
fast-forward into `main` and push at the end (user keeps everything on `main`).

## Objective
Evaluate TEXT agents the way voice agents are evaluated today: an LLM evaluator plays the user in a
chat with the agent over Vivi's channel API, every conversation is recorded, judged and reported.

## Vivi contract (verified in cx-backend, 2026-10-12)
- `POST {base}/channelsApi/{channelId}/invoke` → one `ConversationMessage {message, event, type,
  category, metadata, structuredOutput}` with the full reply. `.../stream` → `text/event-stream`
  but NOT standard SSE: one `data: <ConversationMessage JSON>\n` per line (single newline, no
  `event:`/`id:`). Text = deltas in `event=on_chat_model_stream` with `type` null (join all, across
  several model start/end cycles when tools run); `type="reasoning"` = reasoning (ignore for the
  transcript); tool events `on_tool_start/end` (`metadata.toolName`); status events with
  `event=null`; reply ends with `event="on_chat_end"`. A stream that ends without `on_chat_end` is a
  failure (context-length error sends a canned chunk and no end; other errors just cut the stream).
- Body `UserMessage {message (required), threadId (UUID on API/WEB channels, else 422; same UUID
  every turn continues the conversation), userId (ignored), pageUrl, attachedFiles}`.
- Auth: `/channelsApi` is outside global auth. `vivi-api-key` header is checked only on API-type
  channels (403 missing / 401 wrong). WEB channels (incl. the portal's per-agent TESTING channel)
  need no credentials; their Origin check accepts a missing Origin, the portal URL or the channel's
  safe domains (Referer ignored). 403 when the workspace subscription is not live; 409 on `stream`
  when the agent has a response schema.
- Langfuse: trace `session_id` = `threadId` (same correlation as voice).

## Decisions (user, 2026-10-12)
- Agents get `kind: voice | text`. Text agents: https base URL (http for local hosts), channelId,
  mode `invoke | stream`, auth `none | api_key` (`vivi-api-key`, sealed with SecretBox, never
  returned — hint only), optional Origin. cURL import for text; connection test sends one short
  message (labelled: it reaches the agent).
- Separate text runner reusing the caller policy (text-chat prompt variant) with a max-turns end
  condition; same UUID threadId every turn; latency = request → first text (stream) or → full
  reply (invoke); missing `on_chat_end` fails the turn.
- Scenarios are shared; voice-only fields (voice, TTS connection, interruptions, evaluator mode,
  realtime model) are hidden/not required for text agents; a chat model for the evaluator is
  required.
- Judge: text variant of the prompt (no call/audio/heard), timing from text latencies.
- UI: chat-style transcript and chat metrics instead of the recording card; live view streams
  text; "Voice agent evals" → "Agent evals"; guide updated.

## Tasks
- [x] T1 Backend agents: `kind` + text config + sealed api key (migration), API/validation,
      text target port + HTTP adapter (invoke + stream parser, egress guard), connection test — delegated
- [x] T2 Backend runs: text session runner (max turns, artifacts/summary without audio), launch
      gate + scenario validation by agent kind, evaluator text prompt, manager branch, live text
      events — delegated
- [ ] T3 Judge: text prompt variant, transcript/timing rendering and gating for text runs, brief — delegated
- [ ] T4 Frontend agents + scenarios + launch for text agents (form, cURL import, test, editor
      gating) — delegated
- [ ] T5 Frontend live view + run report for text runs, naming, guide — delegated
- [ ] T6 Real run against a Vivi text agent (paid; ask first) — inline

## Progress
- T1 done (delegated writer, uncommitted): `kind` + text config + sealed `vivi-api-key`
  (migration 0013, DB checks per kind), write-only `apiKey` (`hasApiKey`/`apiKeyHint`), port
  `ports/text_target.py` (`TextTarget.send(message, thread_id=) -> AsyncIterator[TextDelta |
  ToolStarted | ToolEnded | ReplyEnded]`, `collect()` -> `TextReply`), adapter
  `targets/http_chat.py` (`HttpChatTarget`, egress-guarded), text connection test, snapshot
  `kind`/`text_mode`/`auth`/`has_api_key`, launch gate "Text agents cannot be run yet" (T2
  removes it in `runs/service._plan` and the guide). Evidence: RED (import/assert failures)
  then `uv run pytest -q` 1038 passed; ruff check + format clean; migration round trip covered
  by `tests/platform/test_migrations.py`.
- T2 done (delegated writer, uncommitted; route: delegated, writer trigger: 2+ non-trivial
  files). `runner/text_session.py` (`TextSessionRunner`: user writes first, same UUID threadId
  every turn, ends on `caller_hung_up` / `max_turns` / `max_duration` / `caller_silent`;
  `TextTargetError` -> failed `agent_error`, partial reply kept as an `incomplete` row; artifacts
  `transcript.json`, `events.jsonl`, `summary.json`, no audio). Chat prompt variant selected by
  `ChatPolicyState` (evaluator/prompt.py; ports untouched). `EndConditions.max_turns` 1-100
  (default 20, JSONB: no migration). Launch: text agents need an evaluator model connection (no
  TTS fallback), snapshot `connections.tts` null. Manager `drive_text_session`
  (`build_text_target`, `text_transport` overridable; key opened at run time; voice-only settings
  warned). Live: `agentTextDelta`, `agentToolStarted`, `agentToolEnded`. Levels 404 for text runs.
  T1 review fixes: `collect()` closes the events (`aclosing`), `HttpChatTarget.send` yields
  `ReplyEnded` after the response/client closed, stream cap enforced on raw bytes as they arrive.
  Evidence: RED (import errors, failing close/cap/launch/live asserts) then `uv run pytest -q`
  1068 passed; ruff check + format clean.
