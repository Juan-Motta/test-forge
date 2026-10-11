"""Shared run evidence for the judge tests: a snapshot, transcript, summary and model answers."""

from typing import Any

MUST_ID = "11111111-1111-4111-8111-111111111111"
SHOULD_ID = "22222222-2222-4222-8222-222222222222"
TRACE_ID = "33333333-3333-4333-8333-333333333333"

CRITERIA: list[dict[str, Any]] = [
    {"id": MUST_ID, "text": "Confirms the booking", "kind": "must", "source": "transcript",
     "weight": 50},
    {"id": SHOULD_ID, "text": "Replies within 2 s", "kind": "should", "source": "timing",
     "weight": 30},
    {"id": TRACE_ID, "text": "Calls the booking tool once", "kind": "should", "source": "trace",
     "weight": 20},
]  # fmt: skip

SNAPSHOT: dict[str, Any] = {
    "scenario": {
        "id": "44444444-4444-4444-8444-444444444444",
        "name": "Book a table",
        "tags": ["booking"],
        "context": "Friday evening rush.",
        "persona": {"name": "Ana", "locale": "en-US", "temperament": "hurried", "notes": ""},
        "goal": "Book a table for two at 8 pm.",
        "instructions": "Insist on 8 pm.",
        "facts": [{"key": "phone", "value": "555-0100"}],
        "criteria": CRITERIA,
        "end_conditions": {"max_duration_s": 360, "max_silence_s": 15, "hang_up_when": "goodbye"},
        "voice_override": None,
    },
    "agent": {"id": "a", "name": "Vivi", "context": "Restaurant receptionist.",
              "protocol": "vivi_live"},
}  # fmt: skip

TRANSCRIPT: list[dict[str, Any]] = [
    {"role": "agent", "text": "Hello, Bella's, how can I help?", "start_ms": 900.0,
     "end_ms": 2500.0, "latency_ms": None},
    {"role": "caller", "text": "A table for two at 8, please.", "start_ms": 3000.0,
     "end_ms": 4800.0, "reason": "ask"},
    {"role": "agent", "text": "Booked for 8 pm.", "start_ms": 66000.0, "end_ms": 68000.0,
     "latency_ms": 1300.0},
]  # fmt: skip

SUMMARY: dict[str, Any] = {
    "status": "completed",
    "reason": "the caller hung up",
    "duration_ms": 70500.0,
    "caller_turns": 1,
    "agent_turns": 2,
    "turns": [
        {"index": 0, "kind": "greeting", "caller_end_ms": None, "first_audio_ms": 900.0,
         "end_ms": 2500.0, "playback_end_ms": 2600.0, "latency_ms": None, "end_reason": "done"},
        {"index": 1, "kind": "reply", "caller_end_ms": 4800.0, "first_audio_ms": 6100.0,
         "end_ms": 68000.0, "playback_end_ms": 68100.0, "latency_ms": 1300.0,
         "end_reason": "done"},
    ],
    "latencies_ms": [1300.0],
    "warnings": ["the agent turn had no transcript"],
}  # fmt: skip


def verdict(
    criterion_id: str,
    band: Any = 5,
    *,
    observable: bool = True,
    tags: tuple[str, ...] = (),
) -> dict[str, Any]:
    return {
        "criterionId": criterion_id,
        "evidence": [{"source": "transcript", "ref": "A2", "quote": "Booked for 8 pm."}],
        "reasoning": f"reasoning for {criterion_id[:4]}",
        "observable": observable,
        "band": band,
        "failureTags": list(tags),
    }


def answer(*criteria: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    result = {
        "summary": "The agent booked the table but answered slowly.",
        "criteria": list(criteria),
        "suggestions": [
            {"title": "Cache the availability lookup", "detail": "Reply faster on A2.",
             "area": "latency", "priority": "low", "evidenceRefs": ["T2"]},
            {"title": "Confirm the time explicitly", "detail": "Repeat 8 pm back.",
             "area": "prompt", "priority": "high", "evidenceRefs": ["A2"]},
        ],
        "strengths": ["Friendly greeting"],
    }  # fmt: skip
    result.update(overrides)
    return result
