# voice-eval engine

Python engine for evaluating realtime voice agents. The first piece is `voice-probe`, which
holds one scripted conversation with a Vivi voice agent and records everything needed to
inspect turn-taking and latency.

## Target protocols

One endpoint, `wss://<host>/channelApi/<channelId>/realtime?voiceCapability=live-v1&userId=&threadId=`,
serves two protocols; the backend picks one from the agent's configuration.

| | Live (`live`) | Legacy realtime (`realtime`) |
| --- | --- | --- |
| Wire events | `voice.*` | OpenAI Realtime GA events, relayed |
| First frame | `voice.protocol` | `session.created` (carries the model) |
| Ready when | `voice.ready` | first `session.updated` |
| Who starts | agent greets first | **caller must start** (agent never speaks first) |
| Agent turn end | inferred: `--silence-gap-ms` without audio or caption changes | explicit: `response.created` → `response.done`, then `--settle-ms` of quiet |
| Caller text turns | not supported | `--text` (user message + `response.create`) |
| Ending | `voice.close`, server answers `voice.closed` | close the socket with code 1000 |

`--protocol auto` (default) reads the first frame and picks the adapter: `voice.*` means Live,
`session.*` means legacy. Force one with `--protocol live` or `--protocol realtime`.

On the legacy path the server closes the socket (1011) on any client event outside its
allow-list (`session.update`, `input_audio_buffer.*`, `conversation.item.create|delete|truncate`,
`response.create|cancel`), so the probe never sends `voice.*` events there. A tool call makes
the agent produce several responses in a row with `response.processing` ticks while the tool
runs; they all count as one agent turn.

## What the probe does

1. Connects with a fresh UUID4 `threadId` (also the Langfuse session id), detects the protocol,
   and waits for the session to be ready.
2. Streams caller audio like an open microphone: one 100 ms PCM16/24 kHz frame every 100 ms,
   silence when idle (the server runs its own VAD on this stream).
3. Live: waits for the agent's greeting. Legacy: the caller starts, unless `--agent-first`
   asks for an opening agent turn (one `response.create`).
4. For each caller turn, in command-line order: sends the speech plus 600 ms of silence, or the
   text message, then waits for the agent's reply to end.
5. Ends the session (see the table) and writes artifacts. Ctrl-C also ends the session
   gracefully and writes artifacts.

## Setup and tests

```bash
cd engine
uv sync
uv run pytest -q          # offline: fake Live and legacy servers in-process, fake TTS
uv run ruff check . && uv run ruff format --check .
```

## Running

Caller turns come from a TTS provider (`--say`), pre-recorded 24 kHz mono PCM16 WAV files
(`--caller-wav`, provider-free), or text messages (`--text`, legacy protocol only, no TTS
credentials needed). All three flags are repeatable and keep their command-line order.

```bash
uv run voice-probe \
  --base-url wss://<host> \
  --channel-id <channel-id> \
  --user-id <user-id> \
  --say "Hola, quiero consultar mi saldo" \
  --caller-wav ./fixtures/second-turn.wav

# legacy realtime agent, text only (no TTS provider needed)
uv run voice-probe --base-url wss://<host> --channel-id <channel-id> --user-id <user-id> \
  --text "Hola, quiero consultar mi saldo" --text "Gracias, eso es todo"
```

Useful options: `--protocol auto|live|realtime`, `--agent-first`, `--origin <url>`,
`--thread-id <uuid>`, `--silence-gap-ms 900` (Live), `--settle-ms 1200` (legacy),
`--turn-timeout-s 30`, `--max-seconds 180`, `--out <dir>`, `-v`.

`--text` against a Live target fails: with `--protocol live` before connecting (exit 2), with
`auto` right after detection, before any caller input is sent (exit 1, warning in the summary).

### TTS provider configuration (only needed for `--say`)

| Variable | Provider | Default |
| --- | --- | --- |
| `VOICE_EVAL_PROVIDER` | all: `openai`, `azure` (`azure_speech` is planned, not implemented) | `openai` |
| `OPENAI_API_KEY` | openai | required |
| `VOICE_EVAL_TTS_MODEL` | openai | `gpt-4o-mini-tts` |
| `VOICE_EVAL_TTS_VOICE` | openai, azure | `alloy` |
| `AZURE_OPENAI_API_KEY` | azure | required |
| `AZURE_OPENAI_ENDPOINT` | azure | required, e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_API_VERSION` | azure | required |
| `AZURE_OPENAI_TTS_DEPLOYMENT` | azure | required (deployment name) |

Speech is requested as `response_format="pcm"` (raw 24 kHz 16-bit mono), the target's wire format.

## Artifacts (`runs/<timestamp>-<threadId8>/` by default)

- `events.jsonl`: every received event (`dir: in`) with a monotonic `t_ms` offset, plus the
  probe's own actions (`dir: out`: `caller.text`, `caller.request_agent_turn`, `voice.close` or
  `websocket.close`). Audio deltas and binary frames are logged as byte counts only.
- `agent.wav`: concatenated agent audio (gaps between turns are not preserved).
- `caller.wav`: exactly what was sent, silence included.
- `transcript.json`: user/assistant messages. Live: captions ordered by `startMs`. Legacy:
  conversation-item order; assistant text from `response.output_audio_transcript.done` (deltas
  as fallback), user text from `conversation.item.input_audio_transcription.completed`, and
  `--text` turns as sent.
- `summary.json`: `protocol`, `model` (legacy), thread/session ids, per-turn timings, latency,
  `response_count`, `tool_activity`, `end_reason` (legacy fields are `null` on Live), close
  code, usage (Live only).

## Known limitations

- Legacy: an agent turn ends `--settle-ms` after the last `response.done` with no new
  `response.created` or `response.processing`. A tool call whose next response starts later
  than that is split into two turns. If response events go missing, 5 s without agent
  activity ends the turn (`end_reason: fallback_gap`).
- The Live protocol has no response-done event. An agent turn ends after `--silence-gap-ms`
  without new agent audio or caption changes. A mid-reply pause longer than the gap (for example
  while a tool runs) is counted as a turn end, and the next utterance may overlap the agent.
- Latency is measured from the moment the caller's last speech frame (or the text message) is
  sent to the first agent audio delta of the turn. Trailing silence inside the TTS output is counted as speech, and network
  transit is included.
- Agent audio may arrive faster than real time, so turn end reflects delivery, not playback.
