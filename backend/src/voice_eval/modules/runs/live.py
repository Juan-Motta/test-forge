"""In-process live hub: fans each running run's events out to its WebSocket subscribers.

Text messages are JSON objects with a camelCase `type`: `snapshot` (first, always), `status`,
`agentTranscript`, `callerDecision`, `callerSpeaking`, `callerDecisionDiscarded`, `agentBargeIn`,
`callerInterrupted`, `turnEnded`, `warning`, `lagging`, and last `finished`. A `callerDecision`
is only the evaluator's intent: its words join the transcript once `callerSpeaking` confirms they
are being said, and a `callerDecisionDiscarded` one is never said. `callerInterrupted`
(`agentTurn`, `audioEndMs`, `heardText`) marks the caller cutting the agent off: agent audio
already streamed past that point was never heard (a player should drop what it still queues), and
the rest of that reply is not streamed. The agent line of an interrupted turn (`agentTranscript`
and the snapshot) also carries `interrupted`, `heardText` and `audioEndMs`.
Audio goes out as binary frames: one channel byte (`0` agent, `1` caller) followed by the raw
PCM16 little-endian 24 kHz mono chunk.

Every subscriber has its own bounded queue. A slow consumer loses audio frames, never text: once
its queue holds `audio_frames_per_subscriber` frames, newer frames are dropped and it is sent one
`lagging` notice (again for a later episode, after it caught up). A consumer so slow that even its
text backs up past `text_messages_per_subscriber` is disconnected.

Batch subscribers (the overview) get only `status` and `finished` messages (with `runId`), then
`batchFinished` once the batch has no live run left. Everything runs on the event loop: no lock.
"""

import asyncio
import json
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from pydantic.alias_generators import to_camel

from voice_eval.runner.events import RunEvent

AGENT_CHANNEL = 0
CALLER_CHANNEL = 1
AUDIO_CHANNELS = {"agent_audio": AGENT_CHANNEL, "caller_audio": CALLER_CHANNEL}
AUDIO_FRAMES_PER_SUBSCRIBER = 3000  # whole agent replies arrive in bursts; keep them all
TEXT_MESSAGES_PER_SUBSCRIBER = 1000
INTERRUPTION_MARKS = ("interrupted", "heard_text", "audio_end_ms")  # of an interrupted agent line


def message(kind: str, **fields: Any) -> str:
    return json.dumps({"type": kind, **fields}, ensure_ascii=False)


class Subscriber:
    """One consumer's ordered queue of text (str) and audio (bytes); None ends the stream."""

    def __init__(self, audio_limit: int, text_limit: int) -> None:
        self._items: deque[str | bytes | None] = deque()
        self._audio = 0
        self._text = 0
        self._audio_limit = audio_limit
        self._text_limit = text_limit
        self._lagging = False
        self._ready = asyncio.Event()
        self.ended = False
        self.too_slow = False

    def _push(self, item: str | bytes | None, *, first: bool = False) -> None:
        if first:
            self._items.appendleft(item)
        else:
            self._items.append(item)
        self._ready.set()

    def put_text(self, text: str, *, first: bool = False) -> None:
        """Queue a text message; `first` (the snapshot) goes ahead of everything, even the end."""
        if self.ended and not first:
            return
        if self._text >= self._text_limit:
            self.too_slow = True
            self.end()
            return
        self._text += 1
        self._push(text, first=first)

    def put_audio(self, frame: bytes) -> None:
        if self.ended:
            return
        if self._audio >= self._audio_limit:
            if not self._lagging:
                self._lagging = True
                self.put_text(message("lagging", message="audio dropped: the connection is slow"))
            return
        self._audio += 1
        self._push(frame)

    def end(self) -> None:
        if not self.ended:
            self.ended = True
            self._push(None)

    async def get(self) -> str | bytes | None:
        while not self._items:
            self._ready.clear()
            await self._ready.wait()
        item = self._items.popleft()
        if isinstance(item, bytes):
            self._audio -= 1
            if self._audio == 0:
                self._lagging = False  # caught up: a later backlog is a new episode
        elif isinstance(item, str):
            self._text -= 1
        return item


@dataclass
class LiveRun:
    batch_id: uuid.UUID
    status: str = "queued"
    transcript: list[dict[str, Any]] = field(default_factory=list)
    turns: list[dict[str, Any]] = field(default_factory=list)
    subscribers: set[Subscriber] = field(default_factory=set)


def _camel(data: dict[str, Any]) -> dict[str, Any]:
    return {to_camel(key): value for key, value in data.items()}


class LiveHub:
    def __init__(
        self,
        *,
        audio_frames_per_subscriber: int = AUDIO_FRAMES_PER_SUBSCRIBER,
        text_messages_per_subscriber: int = TEXT_MESSAGES_PER_SUBSCRIBER,
    ) -> None:
        self._limits = (audio_frames_per_subscriber, text_messages_per_subscriber)
        self._runs: dict[uuid.UUID, LiveRun] = {}
        self._batches: dict[uuid.UUID, set[Subscriber]] = {}

    def _subscriber(self) -> Subscriber:
        return Subscriber(*self._limits)

    def is_live(self, run_id: uuid.UUID) -> bool:
        return run_id in self._runs

    # --- producers (the run manager) -------------------------------------------------------

    def open(self, run_id: uuid.UUID, batch_id: uuid.UUID) -> None:
        self._runs.setdefault(run_id, LiveRun(batch_id))

    def status(self, run_id: uuid.UUID, status: str) -> None:
        run = self._runs.get(run_id)
        if run is None or run.status == status:
            return
        run.status = status
        self._broadcast(run, message("status", status=status))
        self._to_batch(run.batch_id, message("status", runId=str(run_id), status=status))

    def event(self, run_id: uuid.UUID, event: RunEvent) -> None:
        """Publish one runner event (unknown or internal types are not streamed)."""
        run = self._runs.get(run_id)
        if run is None:
            return
        if (channel := AUDIO_CHANNELS.get(event.type)) is not None:
            if event.pcm:
                frame = bytes([channel]) + event.pcm
                for subscriber in list(run.subscribers):
                    subscriber.put_audio(frame)
            return
        data, t_ms = event.data, event.t_ms
        match event.type:
            case "agent_transcript":
                marks = _camel({key: data[key] for key in INTERRUPTION_MARKS if key in data})
                run.transcript.append(
                    {
                        "role": "agent",
                        "text": data["text"],
                        "turn": data["turn"],
                        "tMs": t_ms,
                        **marks,
                    }
                )
                text = message(
                    "agentTranscript", tMs=t_ms, turn=data["turn"], text=data["text"], **marks
                )
            case "caller_interrupted":
                text = message(
                    "callerInterrupted",
                    tMs=t_ms,
                    agentTurn=data["agent_turn"],
                    audioEndMs=data["audio_end_ms"],
                    heardText=data["heard_text"],
                )
            case "caller_decision":
                text = message(
                    "callerDecision",
                    tMs=t_ms,
                    decisionId=data["decision_id"],
                    say=data["say"],
                    hangUp=data["hang_up"],
                    reason=data["reason"],
                )
            case "caller_speaking":
                run.transcript.append(
                    {"role": "caller", "text": data["say"], "reason": data["reason"], "tMs": t_ms}
                )
                text = message(
                    "callerSpeaking",
                    tMs=t_ms,
                    decisionId=data["decision_id"],
                    say=data["say"],
                    reason=data["reason"],
                )
            case "caller_decision_discarded":
                text = message("callerDecisionDiscarded", tMs=t_ms, decisionId=data["decision_id"])
            case "agent_barge_in":
                text = message("agentBargeIn", tMs=t_ms, callerTurn=data["caller_turn"])
            case "turn_ended":
                run.turns.append(_camel(data))
                text = message("turnEnded", tMs=t_ms, **_camel(data))
            case "warning":
                text = message("warning", tMs=t_ms, message=data["message"])
            case _:
                return
        self._broadcast(run, text)

    def finish(self, run_id: uuid.UUID, status: str, reason: str | None) -> None:
        """The run is over: send `finished`, close its subscribers, forget it."""
        run = self._runs.pop(run_id, None)
        if run is None:
            return
        self._broadcast(run, message("finished", status=status, reason=reason))
        for subscriber in run.subscribers:
            subscriber.end()
        self._to_batch(
            run.batch_id, message("finished", runId=str(run_id), status=status, reason=reason)
        )
        if not any(other.batch_id == run.batch_id for other in self._runs.values()):
            for subscriber in self._batches.pop(run.batch_id, set()):
                subscriber.put_text(message("batchFinished", batchId=str(run.batch_id)))
                subscriber.end()

    def _broadcast(self, run: LiveRun, text: str) -> None:
        for subscriber in list(run.subscribers):
            subscriber.put_text(text)

    def _to_batch(self, batch_id: uuid.UUID, text: str) -> None:
        for subscriber in list(self._batches.get(batch_id, ())):
            subscriber.put_text(text)

    # --- consumers (the WebSocket endpoints) -----------------------------------------------

    def subscribe(self, run_id: uuid.UUID) -> Subscriber | None:
        """A subscriber whose first message is the run's snapshot; None if the run is not live."""
        run = self._runs.get(run_id)
        if run is None:
            return None
        subscriber = self._subscriber()
        snapshot = {
            "id": str(run_id),
            "batchId": str(run.batch_id),
            "status": run.status,
            "endReason": None,
        }
        subscriber.put_text(
            message("snapshot", run=snapshot, transcript=run.transcript, turns=run.turns)
        )
        run.subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, run_id: uuid.UUID, subscriber: Subscriber) -> None:
        if (run := self._runs.get(run_id)) is not None:
            run.subscribers.discard(subscriber)

    def batch_is_live(self, batch_id: uuid.UUID) -> bool:
        return any(run.batch_id == batch_id for run in self._runs.values())

    def subscribe_batch(self, batch_id: uuid.UUID) -> Subscriber | None:
        """A batch subscriber (its snapshot is put first by the caller); None if nothing is live."""
        if not self.batch_is_live(batch_id):
            return None
        subscriber = self._subscriber()
        self._batches.setdefault(batch_id, set()).add(subscriber)
        return subscriber

    def unsubscribe_batch(self, batch_id: uuid.UUID, subscriber: Subscriber) -> None:
        if (subscribers := self._batches.get(batch_id)) is not None:
            subscribers.discard(subscriber)
