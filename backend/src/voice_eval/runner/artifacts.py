"""The files one conversation leaves behind, in an injected directory.

`agent.wav` and `caller.wav` (24 kHz mono PCM16), `transcript.json`, `events.jsonl` (one JSON
object per line, never an audio payload) and `summary.json`.
"""

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from voice_eval.audio import write_wav

ARTIFACT_NAMES = ("agent.wav", "caller.wav", "transcript.json", "events.jsonl", "summary.json")


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def write_artifacts(
    out_dir: Path,
    *,
    events: Iterable[dict[str, Any]],
    agent_pcm: bytes,
    caller_pcm: bytes,
    transcript: list[dict[str, Any]],
    summary: dict[str, Any],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "events.jsonl").open("w") as f:
        for record in events:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    write_wav(out_dir / "agent.wav", agent_pcm)
    write_wav(out_dir / "caller.wav", caller_pcm)
    write_json(out_dir / "transcript.json", transcript)
    write_json(out_dir / "summary.json", summary)
