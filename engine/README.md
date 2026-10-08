# voice-eval engine

Python engine for evaluating realtime voice agents. The first piece is `voice-probe`, which
holds one scripted spoken conversation with a Vivi Live agent (`voiceCapability=live-v1`) and
records everything needed to inspect turn-taking and latency.

## What the probe does

1. Connects to `wss://<host>/channelApi/<channelId>/realtime` with a fresh UUID4 `threadId`
   (also the Langfuse session id) and waits for `voice.ready`.
2. Streams caller audio like an open microphone: one 100 ms PCM16/24 kHz frame every 100 ms,
   silence when idle (the server runs its own VAD on this stream).
3. Waits for the agent's greeting, then for each caller utterance sends the speech plus 600 ms
   of silence and waits for the agent's reply to end.
4. Sends `voice.close`, waits for `voice.closed`, and writes artifacts. Ctrl-C also closes the
   session gracefully and writes artifacts.

## Setup and tests

```bash
cd engine
uv sync
uv run pytest -q          # offline: fake Live server in-process, fake TTS, no network calls
uv run ruff check . && uv run ruff format --check .
```

## Running

Caller speech comes from either a TTS provider (`--say`) or pre-recorded 24 kHz mono PCM16 WAV
files (`--caller-wav`, provider-free). Both flags are repeatable and keep their order.

```bash
uv run voice-probe \
  --base-url wss://<host> \
  --channel-id <channel-id> \
  --user-id <user-id> \
  --say "Hola, quiero consultar mi saldo" \
  --caller-wav ./fixtures/second-turn.wav
```

Useful options: `--origin <url>`, `--thread-id <uuid>`, `--silence-gap-ms 900`,
`--turn-timeout-s 30`, `--max-seconds 180`, `--out <dir>`, `-v`.

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

- `events.jsonl`: every received event with a monotonic `t_ms` offset; audio deltas are logged
  as byte counts only.
- `agent.wav`: concatenated agent audio (gaps between turns are not preserved).
- `caller.wav`: exactly what was sent, silence included.
- `transcript.json`: captions per message, ordered by `startMs`.
- `summary.json`: thread/session ids, per-turn timings and latency, close code, usage.

## Known limitations

- The Live protocol has no response-done event. An agent turn ends after `--silence-gap-ms`
  without new agent audio or caption changes. A mid-reply pause longer than the gap (for example
  while a tool runs) is counted as a turn end, and the next utterance may overlap the agent.
- Latency is measured from the moment the caller's last speech frame is sent to the first agent
  audio delta. Trailing silence inside the TTS output is counted as speech, and network
  transit is included.
- Agent audio may arrive faster than real time, so turn end reflects delivery, not playback.
