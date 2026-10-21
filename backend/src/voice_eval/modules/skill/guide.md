# voice-evaluator

voice-evaluator tests realtime voice agents with simulated phone calls. A simulated **caller**
(the evaluator) phones the **agent under test** over its WebSocket voice protocol, plays a
persona with a goal, and the call is recorded (audio, transcript, per-turn timings). A **judge**
model then scores the call against the scenario's weighted criteria, using the transcript, the
timings and, when available, the agent's Langfuse traces, and writes a Markdown **brief** of
what to change in the agent.

Use this guide to drive the platform through its HTTP API. The endpoint reference at the end is
generated from the running app, so it is always exact; this guide explains the concepts, the
flows and how to read the results.

## Concepts

- **Connection**: provider credentials stored on the platform (secrets are write-only). Kinds:
  `openai`, `azure_openai` (voice, evaluator chat model, realtime models), `azure_speech`
  (stored but cannot synthesize speech yet: do not use it as a voice) and `langfuse` (reads the
  agent's traces).
- **Agent**: the agent under test, of `kind` `voice` (default: its WebSocket `baseUrl`,
  `channelId`, `userId`, optional `origin`, `protocol`) or `text` (a chat over HTTP: `baseUrl`,
  `channelId`, `textMode`, `auth`, optional `origin`), plus an optional Langfuse connection. Its
  `context` (what the agent does) is shared by all its scenarios. A run of a text agent is a
  chat instead of a call (see "Text runs" below).
- **Scenario**: one kind of call to an agent: persona, goal, facts the caller knows, criteria the
  judge scores, end conditions, optional interruptions, and the evaluator setup (voice
  connection, evaluator chat connection, `evaluatorMode`, `realtimeModel`, `voiceOverride`).
- **Scenario group**: a folder of scenarios with a `name` (unique), `description` and `tags`.
  Every scenario lives in exactly one group (`groupId`), and a group may hold scenarios of
  different agents. `GET /api/scenario-groups` lists them with `scenarioCount`, their `agents`
  and `latestScenarioAt`; `POST`, `PATCH` and `DELETE /api/scenario-groups/{groupId}` manage them
  (a group is deleted only once empty: `409` otherwise). A scenario created without `groupId`
  goes to the group named after its agent (created when missing); `PATCH` a scenario's
  `groupId` to move it.
- **Batch** and **run**: launching scenarios creates a batch with one run per scenario and
  repetition. A run is one call. It stores a snapshot of everything it was launched with, so
  editing a scenario later never changes past runs. Each run gets a fresh `threadId`, which is
  also the agent's Langfuse session id.
- **Judgement**: the judge's result for one run, produced automatically after the run ends.
- **API** and **flow**: a saved, reusable sequence of HTTP calls against an API (see "API flows"
  below). Use flows to call an agent's backend or any other API without writing a script, and
  read them to learn how that API is used.

## Authentication

Send an API key on every request:

```
Authorization: Bearer ve_xxxxxxxx_<secret>
```

A human creates keys in the web app (Settings -> API keys) or with `POST /api/api-keys`; the
raw key is shown only once. A key acts as its owner. `GET /api/auth/me` checks who you are.

- `401 {"detail": "Not authenticated"}`: missing, wrong, revoked or expired key (the body is the
  same whatever was wrong). Do not retry with the same key; ask the human for a valid one.
- Public paths (no key): `GET /api/health`, `POST /api/auth/login`, this skill
  (`GET /api/skill`, `GET /api/skill.zip`) and the Swagger UI at `/api/docs`
  (schema: `/api/openapi.json`).
- Never print, log or commit the key. Keep it in an environment variable.

## Conventions and errors

- JSON keys are camelCase in requests and responses. Ids are UUIDs. Times are ISO 8601 (UTC).
- `404 {"detail": "<Thing> not found"}`: unknown id.
- `409 {"detail": "..."}`: a conflict (name already in use, run already finished, judgement
  already in progress, agent still used by scenarios).
- `422 {"detail": [{"type", "loc", "msg"}]}`: invalid input. `loc` points at the field (for
  example `["body", "criteria"]`); the submitted value is never echoed back.
- `PATCH` bodies are partial: only the fields present change. Nested objects (`persona`,
  `endConditions`, `criteria`, `facts`, `interruptions`, a connection's `config`) are replaced
  whole. `null` clears optional references; it is refused for required fields.
- Lists of runs and batches are paginated with `limit` (1-200, default 50) and `offset`, and
  return `{"items": [...], "total": n}`, newest first (`GET /api/runs` also takes
  `order=oldest` for oldest first).

## Costs and human approval

Launching runs and judging them call paid providers: the agent under test (a real voice session
per run), text-to-speech, the evaluator chat model or realtime speech model, and the judge model
(each judgement is 3 judge model calls, plus 1 call for its Spanish version). A batch costs
roughly `scenarios x repetitions` calls. Re-judging costs another judgement. Testing a connection makes one request to the provider.

Each run carries `cost` (null for runs recorded before usage capture): the evaluator's
approximate cost in USD, never the agent's. `callerUsd` is the caller's model usage (realtime
evaluator, or chat + TTS, or chat for text runs), `judgeUsd` the judge's over every judgement
attempt (re-judges and translations included), `totalUsd` their sum, `breakdown` one line per `part` (`caller`,
`judge`) and `model`, and `notes` what is missing. `complete` is false when some tokens have no
price or could not be metered: the TTS speech endpoint reports no usage, so its input tokens are
estimated (4 characters a token) and its audio output is not priced. Prices come from the table
at `GET /api/pricing` (USD per 1M tokens per bucket: `textIn`, `cachedTextIn`, `audioIn`,
`cachedAudioIn`, `textOut`, `audioOut`; null when the model has no such price), seeded with
OpenAI list prices (`source`, `asOf`); Azure OpenAI may differ. `PUT /api/pricing` with
`{"items": [...]}` replaces the table (non-negative numbers; ask your human first).

**Ask your human before** launching runs (`POST /api/runs`), re-running one
(`POST /api/runs/{runId}/rerun`), re-judging (`POST /api/runs/{runId}/judgement`), translating an old judgement
(`POST /api/runs/{runId}/judgement/translations`), testing an
agent's connection (`POST /api/agents/{agentId}/test`, a short real session with the agent) or
running `voice-eval judge-stability`, unless they told
you that you may. State what you will launch (scenarios, repetitions) when you ask. Reading
anything (runs, transcripts, judgements, briefs) is free and safe. Deleting agents, scenarios or
connections, and creating or revoking API keys, also need the human's approval.

## Set up (only when nothing exists yet)

Usually a human has already configured connections, agents and scenarios: list them first with
`GET /api/connections`, `GET /api/agents` and `GET /api/scenarios?agentId={agentId}`.

### Connections

`POST /api/connections` with `{name, kind, config, secrets}`; responses never contain secrets
(only `secretHint`, the last 4 characters, and `hasSecret`).

| Kind | `config` | `secrets` | Used for |
| --- | --- | --- | --- |
| `openai` | `baseUrl` (default `https://api.openai.com/v1`), `ttsModel` (default `gpt-4o-mini-tts`; also `tts-1`, `tts-1-hd`, which lack `ballad`, `verse`, `marin`, `cedar`), `ttsVoice` (default `alloy`) | `apiKey` | caller voice (TTS), evaluator chat model (`gpt-6-luna`), realtime evaluator |
| `azure_openai` | `endpoint`, `apiVersion`, `ttsDeployment`, `ttsVoice`, optional `chatDeployment` (a `gpt-6-luna` deployment), `realtimeDeployment` (`gpt-realtime-2.1-mini`), `realtimeFullDeployment` (`gpt-realtime-2.1`) | `apiKey` | same as `openai`, through deployments |
| `azure_speech` | exactly one of `region` or `endpoint`, `voice` | `key` | not usable for runs yet |
| `langfuse` | `host`, `publicKey` | `secretKey` | the judge reads the agent's traces |

- A scenario needs a **voice connection** (`ttsConnectionId`: `openai` or `azure_openai`) and an
  **evaluator model**: `evaluatorConnectionId` (an `openai` connection, or an `azure_openai` one
  with `chatDeployment`), or, when that is null, the voice connection if it can chat. The judge
  uses the run's evaluator connection.
- A realtime-evaluator scenario uses its voice connection for the realtime model; an
  `azure_openai` voice connection then needs `realtimeDeployment` (or `realtimeFullDeployment`
  for `gpt-realtime-2.1`).
- Trace-based criteria need the agent's `langfuseConnectionId` (a `langfuse` connection).
- `POST /api/connections/{connectionId}/test` checks stored credentials (records `lastTest`
  `{at, ok, detail}`); `POST /api/connections/test` checks a draft `{kind, config, secrets}`
  without storing it. Never put real secrets in examples, files or logs.

### Agents

`POST /api/agents`:

```json
{
  "name": "Support line (staging)",
  "context": "A bank's phone assistant: answers card and account questions, can block a card.",
  "protocol": "auto",
  "baseUrl": "wss://voice.example.com/ws",
  "channelId": "support-es",
  "userId": "evaluator",
  "origin": "https://app.example.com",
  "langfuseConnectionId": "6a1f0c2e-9b7d-4c3a-8e21-5d4b3a2f1e0d"
}
```

- `baseUrl` must be `wss://` (no credentials, query string or fragment). Plain `ws://` is
  accepted only for local hosts: `localhost`, `127.0.0.1` and `host.docker.internal`. When the
  backend runs in Docker and the agent runs on the developer's machine, `localhost` agents are
  dialed through `host.docker.internal` automatically.
- `protocol`: `auto` (detect, default), `live` or `realtime`. `channelId` allows only
  `A-Z a-z 0-9 . _ ~ -`. `origin` is an `http(s)` origin (scheme, host, port), sent when the
  agent checks it.
- `409` when the name is taken; `DELETE /api/agents/{agentId}` answers `409` while scenarios use
  the agent.
- Text agents (`"kind": "text"`, fixed at creation) chat over the Vivi channel API
  (`{baseUrl}/channelsApi/{channelId}/invoke|stream`):

  ```json
  {
    "name": "Support chat (staging)",
    "kind": "text",
    "context": "A bank's chat assistant: answers card and account questions.",
    "baseUrl": "https://vivi.example.com/api",
    "channelId": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    "textMode": "stream",
    "auth": "api_key",
    "apiKey": "<the channel's vivi-api-key>"
  }
  ```

  `baseUrl` must be `https://` (`http://` only for the local hosts above); `channelId` is a UUID;
  `textMode` is `stream` (default) or `invoke` (needed when the agent has a response schema);
  `auth` is `none` (default, e.g. WEB channels) or `api_key` (API channels), which requires
  `apiKey`. The key is write-only: responses carry only `hasApiKey` and `apiKeyHint`; send a new
  `apiKey` to replace it, or `"auth": "none"` to remove it. `userId` and `protocol` apply only to
  voice agents; `textMode`, `auth` and `apiKey` only to text agents.
- Check that the agent answers (ask first): `POST /api/agents/{agentId}/test` opens its
  WebSocket like a run does, waits until the session is ready (8 seconds at most), then closes
  it; no audio is sent. It answers `200` with `reachable`, `latencyMs` (connect + ready),
  `protocol` (`live` or `realtime`, once detected) and `log`, a list of `{ok, message}` steps;
  an unreachable agent has `reachable: false` and a failing last step. For a text agent it sends
  one short message ("Hello, this is a connection test.") in a fresh conversation and waits for
  the whole reply (this reaches the agent, which answers it); `latencyMs` is the reply time and
  `protocol` is `null`.

### Scenarios

`POST /api/scenarios`:

```json
{
  "agentId": "0b8f3c1a-2d4e-4f6a-9b1c-7e5d3a2b1c0f",
  "name": "Lost card, polite caller",
  "tags": ["cards", "smoke"],
  "context": "The caller lost their debit card this morning.",
  "persona": {"name": "Lucía", "locale": "es-MX", "temperament": "polite", "notes": "Speaks briefly."},
  "ttsConnectionId": "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  "evaluatorConnectionId": null,
  "voiceOverride": null,
  "goal": "Get the lost card blocked and learn when a replacement arrives.",
  "instructions": "Do not give the card number unless the agent asks for the last 4 digits.",
  "facts": [{"key": "last 4 digits", "value": "4821"}, {"key": "full name", "value": "Lucía Gómez"}],
  "criteria": [
    {"text": "The agent blocks the card or clearly confirms it is blocked.", "kind": "must", "source": "transcript", "weight": 50},
    {"text": "The agent verifies identity before acting.", "kind": "should", "source": "transcript", "weight": 30},
    {"text": "Every agent reply starts in under 2 seconds.", "kind": "should", "source": "timing", "weight": 20}
  ],
  "endConditions": {"maxDurationS": 360, "maxSilenceS": 15, "hangUpWhen": "goal_or_goodbye"},
  "interruptions": [{"agentTurn": 2, "afterMs": 1500}],
  "evaluatorMode": "pipeline",
  "realtimeModel": "gpt-realtime-2.1-mini"
}
```

- `persona.temperament`: `polite`, `hurried`, `skeptical`, `confused`, `angry`, `friendly`,
  `calm` or `detailed`. `persona.locale` is BCP 47-like (`es-MX`, `en-US`): the caller speaks
  that language and accent. The app's editor offers es-MX, es-CO, es-AR, es-CL, es-PE, es-US,
  es-ES, en-US, en-GB, pt-BR, pt-PT, fr-FR, it-IT and de-DE; the API accepts any tag.
- `facts` are what the caller knows; it reveals each one only when asked. Keys are unique.
- `criteria` (1-30): `kind` `must` (a failure sets `mustFailed`) or `should`; `source` is the
  evidence the judge uses: `transcript` (what was said), `timing` (turn timings and latencies)
  or `trace` (the agent's Langfuse traces: tool calls, models, errors). **Weights must total
  exactly 100.** Each criterion gets a stable `id` (generated when missing; keep it when
  patching so results stay comparable).
- `endConditions`: `maxDurationS` 30-1800 (default 360), `maxSilenceS` 5-120 (default 15,
  voice agents only), `hangUpWhen` `goal_or_goodbye` (default), `goodbye` or `max_duration` (the
  call only ends at its limits), and `maxTurns` 1-100 (default 20, text agents only: the most
  messages the evaluator sends).
- `interruptions` (up to 10, one per agent turn): the caller barges in on the agent's
  `agentTurn`-th reply once `afterMs` (300-60000) of it has played. Supported only on the legacy
  realtime protocol; on others the run warns and does not interrupt.
- `evaluatorMode`: `pipeline` (default: chat model decides, TTS speaks) or `realtime` (a
  speech-to-speech model hears the agent and answers by voice). `realtimeModel`
  (`gpt-realtime-2.1-mini` default, or `gpt-realtime-2.1`) is used only in realtime mode.
- `voiceOverride`: a voice id for this scenario; `null` keeps the voice (TTS) connection's own
  voice. In realtime mode it must be one of `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`,
  `shimmer`, `verse`, `marin`, `cedar`. In pipeline mode, OpenAI and Azure OpenAI voice
  connections (`gpt-4o-mini-tts`) also have `fable`, `nova` and `onyx`.
- Names are unique per agent (`409`). `POST /api/scenarios/{scenarioId}/duplicate` copies one as
  `<name> (copy)`.

## Flow: launch a batch and follow it

1. Pick scenarios: `GET /api/scenarios?groupId={groupId}` or `?agentId={agentId}` (optional
   `tag=` filter).
2. With the human's approval, launch: `POST /api/runs`

   ```json
   {"scenarioIds": ["9d2e7f4a-1b3c-4d5e-8f6a-7b8c9d0e1f2a"], "repetitions": 3, "concurrency": 1, "label": "after prompt fix"}
   ```

   `scenarioIds` 1-20, `repetitions` 1-10, `concurrency` 1-10 (runs of this batch at once; the
   server also caps runs across all batches). Response `201`, the batch with its queued runs:

   ```json
   {
     "id": "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c",
     "label": "after prompt fix",
     "concurrency": 1,
     "status": "queued",
     "total": 3,
     "counts": {"queued": 3},
     "createdBy": "2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091",
     "createdAt": "2026-10-12T09:30:00Z",
     "runs": [
       {"id": "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918", "batchId": "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c", "position": 0,
        "scenarioId": "9d2e7f4a-1b3c-4d5e-8f6a-7b8c9d0e1f2a", "scenarioName": "Lost card, polite caller",
        "agentId": "0b8f3c1a-2d4e-4f6a-9b1c-7e5d3a2b1c0f", "agentName": "Support line (staging)",
        "threadId": "c0ffee00-1234-4abc-9def-0123456789ab", "status": "queued", "endReason": null, "error": null,
        "createdAt": "2026-10-12T09:30:00Z", "startedAt": null, "endedAt": null,
        "judgementStatus": null, "score": null, "mustFailed": null, "persona": "Lucía",
        "callerTurns": null, "agentTurns": null, "latencyP50Ms": null}
     ]
   }
   ```

   A scenario that cannot run (no voice connection, no evaluator model; a text agent's scenario
   needs an evaluator model connection and no voice connection) makes the whole launch
   `422` with one item per refused scenario: `{"type", "loc": ["body", "scenarioIds", i],
   "msg", "scenarioId"}`. Fix the scenario (or ask the human) instead of retrying.
3. Follow it. Poll `GET /api/runs/batches/{batchId}` every 10-15 seconds (a call lasts up to
   the scenario's `maxDurationS`, 6 minutes by default). The batch is over when its `status` is
   `completed` or `cancelled`; each run's `status` tells where it is. Or open the live
   WebSocket (below).
4. When a run is finished, read it with `GET /api/runs/{runId}` and its judgement with
   `GET /api/runs/{runId}/judgement` (next flows).
5. Stop early if needed: `POST /api/runs/{runId}/cancel` or
   `POST /api/runs/batches/{batchId}/cancel` (`202`; `409` when already finished).

Other reads: `GET /api/runs?status=&scenarioId=&batchId=&order=&limit=&offset=` (runs; `order` is
`newest`, the default, or `oldest`)
and `GET /api/runs/batches` (batches with per-status `counts`).

Run one scenario again (paid, ask first): `POST /api/runs/{runId}/rerun` launches the run's
scenario as it is now, one run in a new batch labelled `Re-run of <first 8 characters of the
run id>`. Response `201`, the batch, like a launch; `422` like a launch when the scenario cannot
run, `409` when the scenario was deleted.

Overview of recent activity: `GET /api/stats/overview?days=7` (`days` 1-90) aggregates the runs
created in the window: `runs` (`count`, and `previousCount` for the window just before),
`averageScore` (0-100, completed judgements), `goalCompletion` (0-1, share of completed
judgements whose must criteria passed), `latency` (`p50Ms`, `p95Ms` over every response
latency), `live.active` (runs queued, connecting or running now), `weakestCriteria` (up to 5,
lowest `averageScore` first, with `text`, `scenarioName`, `judged`), `suggestions` (`open`,
`highPriority`) and `spend` (`totalUsd` and `previousTotalUsd`: the evaluator and judge cost of
the window's runs at the list prices in Settings → Model prices, approximate; `complete` is false
when some usage had no price or TTS audio was not metered). Aggregates without data are `null`.

### Run statuses and end reasons

`status`: `queued` -> `connecting` -> `running` -> one terminal status:

| Status | Meaning |
| --- | --- |
| `completed` | The call ended normally. |
| `failed` | Something broke; `error` is a short safe message. |
| `cancelled` | Cancelled through the API. |
| `interrupted` | The server stopped under the run. |

`endReason` says why:

| `endReason` | Status | Meaning |
| --- | --- | --- |
| `caller_hung_up` | completed | The caller reached its goal or said goodbye and hung up. |
| `agent_ended` | completed | The agent closed the session. |
| `max_duration` | completed | The scenario's `maxDurationS` was reached. |
| `max_silence` | completed | Nobody spoke for `maxSilenceS`. |
| `max_turns` | completed | Text runs: the evaluator sent `maxTurns` messages. |
| `caller_silent` | completed | Text runs: the evaluator had nothing to write three times in a row. |
| `agent_error` | failed | Text runs: the agent could not answer a message (`error` says why, e.g. its stream ended without its final event). |
| `connect_failed` | failed | The agent's WebSocket could not be reached. |
| `protocol_error` | failed | The agent's protocol could not be detected or was violated. |
| `ready_timeout` | failed | The agent never said its session was ready. |
| `connection_closed` | failed | The agent connection closed unexpectedly. |
| `tts_failed` | failed | The caller's speech synthesis failed. |
| `evaluator_failed` | failed | The evaluator chat model failed. |
| `realtime_failed` | failed | The realtime evaluator failed. |
| `caller_audio_failed` | failed | Sending the caller's audio failed. |
| `setup_failed` | failed | Providers could not be built (check the scenario's connections). |
| `internal_error` | failed | An unexpected error. |
| `cancelled` | cancelled | Cancelled through the API. |
| `shutdown`, `server_restarted` | interrupted | The backend stopped or restarted during the run. |

A run is judged automatically when it ends `completed`, or `failed` after the agent took at
least one turn. Cancelled and interrupted runs are not judged (their judgement is
`{"status": "none"}`).

## Reading a run

`GET /api/runs/{runId}` returns the run fields above plus `summary`, `transcript` (both once the
run is finished) and `snapshot` (what it was launched with: scenario, agent, caller brief,
connections; never a secret).

### Summary fields

| Field | Meaning |
| --- | --- |
| `status`, `reason`, `error` | The runner's own outcome (same as the run's `status` and `endReason`). |
| `protocol`, `model`, `sessionId`, `channelId` | What the agent's session reported. |
| `threadId`, `langfuseSessionId` | The run's thread id (the agent's Langfuse session id). |
| `startedAt`, `durationMs` | When the call started and how long it lasted. |
| `callerTurns`, `agentTurns` | Turns taken by each side. |
| `latenciesMs` | Agent response latency of each reply, in ms. |
| `turns` | One row per agent turn: `index`, `kind` (`reply`, `greeting`, `unprompted`), `callerEndMs`, `firstAudioMs`, `endMs`, `playbackEndMs`, `callerResumedMs`, `latencyMs`, `audioMs`, `responseCount`, `toolActivity`, `endReason` (`audio_gap`, `response_done`, `stalled`, `interrupted`). |
| `interruptions` | Barge-ins the caller made: `agentTurn`, `audioEndMs`, `heardChars`, `totalChars`, and whether the agent's server confirmed it applied the cut: `confirmation` (`truncated`, `deleted` when no reported item had played, or `null` until every reported item is confirmed), `confirmedAudioEndMs` (where the server truncated, which may differ from what was sent), `confirmedAtMs` (run clock), and `items` (one per item reported: `itemId`, `sentAudioEndMs`, `confirmation`, `confirmedAudioEndMs`). A confirmation counts until the run ends, even after later turns. |
| `evaluatorMode`, `realtimeModel` | How the caller was played. |
| `usage` | The evaluator's token usage (null before usage capture): `byModel` maps each model to its tokens per bucket (`textIn`, `cachedTextIn`, `audioIn`, `cachedAudioIn`, `textOut`, `audioOut`; reasoning tokens count as `textOut`), and `notes` flags estimates (`tts_text_estimated`, `tts_audio_not_metered`). The run's `cost` prices it. |
| `closeCode`, `closeReason`, `usageSeconds`, `finalUsageConfirmed` | How the agent session closed. |
| `warnings` | Notable problems that did not fail the run (read them). |
| `eventCounts` | How many events of each type the run produced. |

**Agent latency** is the time from the end of the caller's speech to the agent's first audio
(`latencyMs = firstAudioMs - callerEndMs`). All `*Ms` timings are milliseconds since the run
started. The run's `latencyP50Ms` is the median of `latenciesMs`. A greeting or unprompted turn
has no latency. As a rough guide for a phone conversation, a median under about 1500 ms feels
responsive and replies over about 3000 ms feel broken, but the scenario's own `timing` criteria
are what the judge applies.

### Text runs

A run of a text agent is a chat over the agent's channel API: the evaluator's chat model plays
the user and always writes first, every message goes to the run's `threadId` (a UUID, the same
every turn, which is also the agent's Langfuse session id), and the agent's reply is read whole
(`invoke`) or as it streams (`stream`). Each reply waits for its user message, so there is no
silence limit; the chat ends when the evaluator ends it, after `maxTurns` messages, or at
`maxDurationS`. Voice settings of the scenario (voice, interruptions, realtime evaluator) are
ignored, with a warning. A text run records no audio: its audio and levels endpoints answer
`404`. Its summary adds `kind: "text"`, `textMode` and `maxTurns`, and each of its `turns` is
`{index, kind: "reply", requestMs, firstTextMs, endMs, latencyMs, tools}` (the tools the agent
used). **Text latency** is from sending the message to the reply's first text (`stream`) or to
the whole reply (`invoke`). Caller rows have `startMs` = `endMs` = when the message was sent;
agent rows add `firstTextMs` (from the request) and `tools`, and a reply that broke off keeps
what arrived with `"incomplete": true`.

### Transcript rows

`transcript` is the conversation in order:

- Caller row: `{"role": "caller", "text", "startMs", "endMs", "reason"}`; `reason` is the
  evaluator's own reason for saying it.
- Agent row: `{"role": "agent", "text", "startMs", "endMs", "playbackEndMs", "latencyMs"}`. An
  interrupted reply adds `"interrupted": true`, `"heardText"` (about what the caller heard
  before cutting in), `"heardTextEstimated": true`, `"audioEndMs"` (how much of the reply's
  audio played) and `"interruptionConfirmed"` (whether the agent's server confirmed it applied
  the cut). `heardText` is an estimate: the played share of the audio applied to the text, cut
  at a word boundary, so it can be off by a word or so around the cut. Only about `heardText`
  reached the caller; the rest of `text` was generated but never heard.

```json
[
  {"role": "agent", "text": "Hola, soy el asistente del banco. ¿En qué te ayudo?", "startMs": 410.2, "endMs": 3105.0, "playbackEndMs": 3420.5, "latencyMs": null},
  {"role": "caller", "text": "Perdí mi tarjeta de débito esta mañana.", "startMs": 3990.1, "endMs": 6120.7, "reason": "State the problem."},
  {"role": "agent", "text": "Lo siento. Para bloquearla necesito validar tu identidad y después…", "startMs": 7010.4, "endMs": 9800.0, "playbackEndMs": 9950.0, "latencyMs": 889.7,
   "interrupted": true, "heardText": "Lo siento. Para bloquearla necesito validar tu identidad", "heardTextEstimated": true, "audioEndMs": 1500, "interruptionConfirmed": true}
]
```

Audio: `GET /api/runs/{runId}/audio/conversation` returns the whole conversation as one WAV
(PCM16, 24 kHz, mono): both sides mixed on the run timeline, with the pauses, overlaps and
barge-in cuts as they happened (`?download=1` sends it as an attachment named
`run-<first 8 of id>-conversation.wav`; `409` while the run is in progress). `GET /api/runs/{runId}/audio/{channel}` with `channel`
`agent` or `caller` returns one side once the run is finished; those two files are not aligned
in time (the agent's holds only the audio it sent, back to back). `404` when there is no audio.

Audio levels on the run timeline: `GET /api/runs/{runId}/levels?bins=140` (`bins` 20-400)
returns `durationMs`, `agent` and `caller` (one RMS value 0-1 per bin, one scale for both sides,
placed with the run's audio events) and `turns` (`role`, `startMs`, `endMs`, `ref` `A<n>` or
`C<n>`, the refs the judge cites). `409` while the run is in progress.

Agent trace: `GET /api/runs/{runId}/trace` returns the agent's Langfuse observations saved when
the run was judged: `available`, `note` (why there is none), `stats` and `observations`, each
with `id`, `traceId`, `parentId`, `type` (`llm`, `tool`, `span`, `event`, ...), `name`,
`startMs` (from the run start), `durationMs`, `model`, `tokens`, `costUsd`, `level`,
`statusMessage` and `depth` (nesting), sorted by start. `langfuse` links the run in Langfuse's
UI, or is `null` when the agent has no Langfuse connection (or the run is in progress):
`threadTracesUrl` opens Langfuse's trace list filtered on `metadata.thread_id` (the run's `threadId`), every turn's trace together, and is `null`
when Langfuse could not be asked for the project; `traceUrl` opens the first trace only, `null`
without saved observations.

## Reading the judgement

`GET /api/runs/{runId}/judgement` returns `{"status": "none"}` when the run was never judged,
otherwise:

```json
{
  "status": "completed",
  "result": {"version": 2, "overallScore": 78, "mustFailed": false, "brief": "# Voice agent review: ...", "...": "..."},
  "traceStats": {"...": "..."},
  "traceNote": null,
  "error": null,
  "model": "gpt-6-luna",
  "attempt": 1,
  "createdAt": "2026-10-12T09:36:10Z",
  "updatedAt": "2026-10-12T09:41:55Z",
  "completedAt": "2026-10-12T09:41:55Z",
  "usage": {"by_model": {"gpt-6-luna": {"text_in": 41200, "text_out": 6100}}},
  "language": "en",
  "translationStatus": "ready",
  "translationError": null
}
```

`status`: `pending` -> `collecting_traces` (only when the agent has a Langfuse connection) ->
`judging` -> `completed` or `failed` (`error` says why). The run's `judgementStatus`, `score` and
`mustFailed` mirror it in run lists (`score` and `mustFailed` are `null` until it is
`completed`).

**Waiting**: Langfuse makes traces readable slowly, so with a Langfuse connection the judge
polls them every 30 s until two polls agree, for up to 20 minutes after the run ended. Expect a
judgement within a few minutes without Langfuse and up to about 20 minutes with it. Poll
`GET /api/runs/{runId}/judgement` (or the batch, whose runs carry `judgementStatus`) every 30-60
seconds until `completed` or `failed`. Without traces the judge still runs and `traceNote` says
why they are missing.

**Languages**: the judge reasons and writes in English. After each judgement, one more call of
the same judge model makes its Spanish version. `GET /api/runs/{runId}/judgement?lang=es`
returns the result with the Spanish `summary`, criterion `rationale`s, suggestion `title`s and
`detail`s, `strengths` and `brief` once that version is ready; `lang` is `en` (default) or `es`
(anything else is `422`). Criterion texts, evidence quotes, refs, tags, scores and ids are never
translated. `language` says which texts came back; `translationStatus` is the Spanish
version's state: `none` (judgements made before translations), `pending`, `ready` or `failed`
(`translationError` says why; the judgement itself is unaffected). Until it is `ready`, `lang=es`
returns the English texts.

**Translate an old judgement** (paid, one judge model call, ask first):
`POST /api/runs/{runId}/judgement/translations?lang=es` -> `202` with the judgement in that
language and its `translationStatus` (`pending` while it is made; poll the `GET`). Idempotent: a
`ready` or `pending` version is returned as is, a `none` or `failed` one is (re)started. `409`
while the run is being judged or when it has no completed judgement.

**Re-judge** (paid, ask first): `POST /api/runs/{runId}/judgement` -> `202`, the judgement reset
to `pending` with the next `attempt`; the new result replaces the old one (its Spanish version
is made again). `409` while the run
or a judgement of it is in progress.

### The result (version 2)

| Field | Meaning |
| --- | --- |
| `overallScore` | 0-100: weighted mean of the observable criteria's scores, renormalized by their weight; `null` when no criterion was observable. |
| `mustFailed` | `true` when any `must` criterion's verdict is `fail`, whatever the score. Treat it as a failed call. |
| `observableWeight` | Total weight of the criteria that were judged (100 when all were). |
| `criteria` | One result per criterion (below). |
| `failureTags` | `{tag: number of criteria carrying it}`, most frequent first. |
| `summary` | The judge's summary of the call. |
| `suggestions` | `{title, detail, area, priority, evidenceRefs}`; `area` `prompt`, `tools`, `flow`, `latency`, `voice` or `other`; `priority` `high`, `medium` or `low`. |
| `strengths` | What worked. |
| `brief` | Markdown review for a coding agent (below). |
| `traceStats`, `traceNote` | Trace digest stats; why traces are missing or partial. |
| `model`, `samples`, `version` | Judge model, successful judge samples (normally 3), result version (2). |

Per criterion: `criterionId`, `text`, `kind`, `source`, `weight`, `verdict`, `score`, `band`,
`failureTags`, `unobservableReason`, `capped`, `rationale`, `evidence` (`[{source, ref,
quote}]`) and `sampleBands`.

- **Bands -> scores and verdicts**: the judge picks a band 1-5; code maps it to a score
  (5 -> 100, 4 -> 90, 3 -> 70, 2 -> 50, 1 -> 25) and a verdict (4-5 `pass`, 3 `partial`, 1-2
  `fail`).
- **Caps**: the tags `fabricated_information`, `wrong_information`, `instruction_ignored` and
  `unsafe_or_policy_violation` cap the criterion at band 2 (`capped: true` when that lowered
  it). A capped criterion is a serious defect even when the overall score looks fine.
- **Failure tags** (closed list): the four capping tags above, plus
  `missing_information_request`, `incomplete_task`, `off_topic`,
  `unclear_or_unnatural_speech`, `cut_off_or_incomplete_reply`, `slow_response`,
  `tool_or_trace_error`. At most 5 per criterion; a band 5 criterion has none.
- **Not observable** (`verdict: "not_observable"`, `score` and `band` null): it neither helps nor
  hurts the score. `unobservableReason`: `traces_unavailable` (a `trace` criterion without
  traces: give the agent a Langfuse connection or wait for traces and re-judge),
  `no_timing_data` (a `timing` criterion without turn timings), `judge_marked_unobservable` (the
  evidence did not show it) or `judge_omitted` (the judge gave no verdict).
- **Samples**: each judgement asks the judge 3 times on identical evidence; a criterion's band is
  the lower median of the samples that observed it, and `sampleBands` lists each sample's band
  (`null` where it was not observable). Bands that disagree (for example `[2, 4, 4]`) mean the
  criterion is ambiguous: consider rewriting it more concretely.
- **Evidence refs**: `A<n>` is the agent's n-th turn and `C<n>` the caller's n-th turn in the
  transcript, `T<n>` the n-th agent turn's timing row, `R<n>` the n-th Langfuse trace of the
  session. `evidence[].quote` holds the exact words or values the judge relied on.

### Interpreting

- **Good**: `mustFailed` false, `overallScore` 90 or more, no capped criterion, no capping tag in
  `failureTags`, every criterion observable, `sampleBands` consistent.
- **Needs work**: any `must` fail, any capped criterion, `overallScore` under about 70, or
  repeated tags such as `slow_response` or `incomplete_task` across runs.
- **Inconclusive**: low `observableWeight` (many criteria not observable) or a run that ended
  early (`failed`, `max_silence`). Fix the setup before drawing conclusions about the agent.
- One run is a sample of one. Compare repetitions of the same scenario (launch with
  `repetitions` 3 or more) and look at the spread of `score` before concluding that a change
  helped. Compare runs by listing them with `GET /api/runs?scenarioId={scenarioId}` and reading
  each judgement.

### The brief

`result.brief` is Markdown written to be pasted alone into a coding agent: the run, the score
and must-failure, failure tags, the problems found (failed and partial criteria with band, tags
and evidence), what was not observable and why, the changes to make (highest priority first),
what worked, the passed criteria and how to verify the fix (re-run the same scenario and
compare). When your task is to improve the agent, start from the brief.

## Live stream (WebSocket)

- One run: `wss://<host>/api/runs/{runId}/live`. A batch overview:
  `wss://<host>/api/runs/live?batchId={batchId}`. Use `ws://` when the platform is plain
  `http://` (local development).
- Authenticate with the header `Authorization: Bearer ve_xxxxxxxx_<secret>` on the upgrade
  request. The server accepts, then closes with `4401` (not authenticated), `4403` (a browser
  cookie from a foreign origin) or `4404` (unknown run or batch). `1013` means you read too
  slowly; `1000` is the normal end.
- The client sends nothing; just read.

Text frames are JSON with a `type` and, where it applies, `tMs` (ms since the run started):

| `type` | Fields |
| --- | --- |
| `snapshot` | Always first: `run {id, batchId, status, endReason}`, `transcript` so far (caller lines carry their `decisionId`), `turns` so far. |
| `status` | `status` (`connecting`, `running`). |
| `agentTranscript` | `turn`, `text`; an interrupted turn adds `interrupted`, `heardText` (an estimate), `heardTextEstimated`, `audioEndMs`. |
| `callerDecision` | `decisionId`, `say`, `hangUp`, `reason`: the evaluator's intent, not yet said. |
| `callerSpeaking` | `decisionId`, `say`, `reason`: the caller started saying it (only now it joins the transcript). |
| `callerText` | `decisionId`, `text`: the next piece of the evaluator's words, in order, while the realtime evaluator speaks; it extends that caller line. The realtime evaluator's `callerSpeaking` carries only the words transcribed so far (often none), and its `callerDecision` comes after, with the whole text as `say`, which replaces the line's text. |
| `callerDecisionDiscarded` | `decisionId`: the agent spoke again first; that decision is never said. |
| `agentBargeIn` | `callerTurn`: the agent started talking while the caller was mid-utterance. |
| `callerInterrupted` | `agentTurn`, `audioEndMs`, `heardText`: the caller cut the agent off. |
| `interruptionConfirmed` | `agentTurn`, `itemId`, `kind` (`truncated` or `deleted`), `audioEndMs` (as the agent's server applied it): one per reported audio item, possibly after later turns; none when the server never confirms. |
| `turnEnded` | `turn`, `firstAudioMs`, `endMs`, `playbackEndMs`, `latencyMs`, `endReason` (text runs: `turn`, `requestMs`, `firstTextMs`, `endMs`, `latencyMs`). |
| `agentTextDelta` | Text runs: `turn`, `text`: the next piece of the reply as it streams (the whole reply then comes as `agentTranscript`). |
| `agentToolStarted`, `agentToolEnded` | Text runs: `turn`, `name`; the end adds `success` and `elapsedMs` when the agent reports them. |
| `warning` | `message`. |
| `lagging` | `message`: audio frames were dropped for you (text never is). |
| `finished` | Always last: `status`, `reason`. |

In a text run, `callerSpeaking` means the message was sent, and no binary frame is sent.
Binary frames are audio: one channel byte (`0` agent, `1` caller) followed by raw PCM16
little-endian, 24 kHz, mono samples. A run that is no longer live sends its `snapshot` and
`finished`, then closes. The batch overview sends a `snapshot` (`batch`, `runs`), then `status`
and `finished` messages with `runId`, and `batchFinished` once no run of the batch is live.

Polling is simpler and enough for an agent; use the WebSocket only when you need turn-by-turn
progress.

## API flows

Humans save the calls they make to an API as **flows**, so you can reuse them instead of writing
scripts, and so the flows document how the API works. Read them before calling an API yourself.

- **API** (`/api/apis`): `name`, `description`, `tags`, `baseUrl`, `headers` every step sends
  (use them only for what really goes on every call, like `Accept`), plain `variables`
  (`{"tenant": "acme"}`) and named **secrets** (an API key, a password). A name is a variable or a
  secret, not both. Responses show secrets as `{"name", "hint"}` only;
  `GET /api/apis/{apiId}/secrets` returns them in clear. Ask for them only when you must use one
  outside a flow, and never print them.
- **Flow** (`/api/flows`): `name`, `description` (what it is for), typed `inputs` and ordered
  `steps`, plus `agentIds`: the agents it is meant for.

**Find** the flows for your work: `GET /api/flows?agentId=<agent>` (flows meant for an agent),
`GET /api/flows?apiId=<api>`, or `GET /api/apis` then a flow's `description`.

**Read** a flow: each step has `method`, `path` (added to the API's `baseUrl`), `query`,
`headers`, a JSON `body`, `saves` (values it reads from its response for later steps) and
`checks`. Text in a step may contain placeholders:

- `{{input.<name>}}`: a flow input;
- `{{var.<name>}}`: one of the API's variables or secrets (a secret stays sealed in records);
- `{{secret.<name>}}`: one of the API's secrets (the older form, still accepted);
- `{{saved.<name>}}`: a value an earlier step saved (`saves: [{"name": "token", "path":
  "body.access_token"}]`). Paths are `status`, `headers.<name>` or `body.a.0.b`.

Checks are `{"type": "status", "equals": 200}`, `{"type": "duration", "maxMs": 500}` and
`{"type": "path", "path": "body.items.length", "op": ">", "value": 0}`, where `op` is `exists`,
`absent` (no value), `==`, `!=`, `>`, `>=`, `<` or `<=`.

**GraphQL** is a `POST` whose JSON body is `{"query": "...", "variables": {...}}`; put
placeholders in `variables`, not in the query text. A GraphQL API answers `200` even when the
query fails, so check `{"type": "path", "path": "body.errors", "op": "absent"}` as well as the
status.

A body string that is exactly one placeholder keeps the value's type (a `number` input stays a
number). Inputs have a `type` (`text`, `number`, `boolean`), an optional `default`, and an
optional `generate`: a description from which AI writes a value when none is given.

**Run** a flow (it costs nothing beyond the API calls, plus one chat call when AI writes inputs):

```
POST /api/flows/{flowId}/runs
{"inputs": {"query": "king size linen"}}
```

The call returns when every step is done (each step has 30 s), with `201` and the whole trace,
even when a step failed:

- `status`: `passed` when every step passed, else `failed`.
- `inputs`: each value used and its `source` (`given`, `default` or `generated`).
- `steps[]`: `status` (`passed`, `failed`, `skipped` after a failure), `request` (as sent;
  secrets appear as `{{secret.<name>}}`), `response` (`status`, `headers`, `body` as JSON when
  the API sent JSON, `sizeBytes`), `durationMs`, `saved`, `checks` (`{check, passed, actual}`)
  and `error` (why the step failed when it was not a check: `could not save token (body.jwt not
  found)`, `could not connect to the API`, `no response within 30 s`, ...).

To find what went wrong, read the first step whose `status` is `failed`: its `error`, the checks
with `passed: false` (compare `actual` with the check), then its `response`.

Errors: `422` when inputs are unusable (`loc` is `["body", "inputs", "<name>"]`: unknown input,
wrong type, or a value is required); `502` when AI could not write inputs.

`GET /api/flows/{flowId}/runs` lists past runs (newest first; `limit` 1-50, default 20),
`GET /api/flow-runs` lists every flow's runs as summaries (`{items, total}`, newest first;
`status`, `apiId`, `flowId`, `limit`, `offset`) and `GET /api/flow-runs/{runId}` reads one. Each
flow also carries `lastRun` (`id`, `status`, `createdAt`, `durationMs`, or null). As shell commands: `GET /api/flows/{flowId}/curl`
(before a run; query parameters fill inputs by name) and
`GET /api/flow-runs/{runId}/steps/{index}/curl` (as sent in a run; `index` from 0). Both mask
secrets unless `?reveal=true`.

**Save** a flow you worked out, so others (and you, next time) can reuse it: `POST /api/flows`
with `apiId`, `name`, `description`, `inputs`, `steps` and `agentIds`. References are checked:
an unknown input or secret, or a saved value used before the step that saves it, is a `422`
whose `loc` points at the text (for example `["body", "steps", 1, "headers", 0, "value"]`).
Ask the human before creating or changing APIs, secrets or flows.

## API keys

`GET /api/api-keys` lists your keys (`prefix` only, never the secret);
`POST /api/api-keys` `{"name": "ci", "expiresInDays": 30}` creates one and returns `key` once;
`DELETE /api/api-keys/{keyId}` revokes one. Ask the human before creating or revoking keys.

## Measuring judge stability (CLI)

`voice-eval judge-stability <run id or prefix> [--times 3] [--json]` judges one finished run
several times (2-10) on the same evidence and reports, per criterion, the band spread and
verdict flips; it stores nothing. It is a command-line tool, not an HTTP endpoint: it runs where
the backend runs (for example `docker compose exec backend voice-eval judge-stability <run id>`),
so ask the human to run it if you have no shell there. Each time costs 3 judge model calls.

## Fetching this skill

`GET /api/skill` returns this document; `GET /api/skill.zip` returns the skill folder
(`voice-evaluator/SKILL.md` and `voice-evaluator/reference/openapi.json`) to unzip into a skills
directory. Both are public: no API key is needed to fetch them.
