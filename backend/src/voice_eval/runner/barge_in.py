"""Barge-in: the caller cutting the agent off mid-reply, like a person on the phone.

The agent's audio arrives faster than real time, so the runner simulates its playback: an agent
turn plays back to back from its first audio delta, item after item, in arrival order. A
scenario interruption cuts agent turn N once `after_ms` of it has played. At the cut each audio
item still playing gets its played milliseconds (whole samples / 24, never more than what was
received) and every item not started yet gets None, which is what the web client reports in
`playback.interrupted`. The caller then hears only the part of the agent's text proportional to
the audio that played.
"""

from dataclasses import dataclass

from voice_eval.audio import SAMPLE_RATE, SAMPLE_WIDTH

SAMPLES_PER_MS = SAMPLE_RATE // 1000


@dataclass(frozen=True)
class Interruption:
    """Cut the agent's `agent_turn`-th reply (from 1) once `after_ms` of it has played."""

    agent_turn: int
    after_ms: int


@dataclass
class AudioItem:
    """One conversation item of agent audio, as received (bytes keep growing while it streams)."""

    item_id: str
    response_id: str | None
    audio_bytes: int = 0


@dataclass(frozen=True)
class ItemCut:
    """An item still playing at the cut: `audio_end_ms` played, or None when not started."""

    item_id: str
    response_id: str | None
    audio_end_ms: int | None


@dataclass(frozen=True)
class Cut:
    """What the runner cut: the agent turn, how much of it played and which items it held."""

    agent_turn: int
    audio_end_ms: int  # whole milliseconds of the turn that played
    fraction: float  # of the turn's received audio that played
    item_ids: set[str]
    reported: tuple[ItemCut, ...] = ()  # the items reported to the agent in playback.interrupted


def played_ms(audio_bytes: int) -> int:
    """Whole milliseconds of `audio_bytes` of PCM16 24 kHz: floor(samples / 24)."""
    return (audio_bytes // SAMPLE_WIDTH) // SAMPLES_PER_MS


def position_bytes(position_ms: float) -> int:
    """The audio bytes played after `position_ms` of playback, in whole samples."""
    return int(position_ms * SAMPLES_PER_MS) * SAMPLE_WIDTH


def playback_cuts(items: list[AudioItem], position_ms: float) -> list[ItemCut]:
    """The items still playing when playback is cut at `position_ms` from the turn's start.

    Items that finished playing are left out; the one playing reports what played of it, the
    ones after it report None.
    """
    position = position_bytes(position_ms)
    cuts = []
    start = 0
    for item in items:
        end = start + item.audio_bytes
        if position < end:
            played = position - start
            audio_end_ms = played_ms(played) if played > 0 else None
            cuts.append(ItemCut(item.item_id, item.response_id, audio_end_ms))
        start = end
    return cuts


def heard_text(text: str, fraction: float) -> str:
    """The first `fraction` of `text`, cut back to the last whole word."""
    text = text.strip()
    if fraction >= 1:
        return text
    if fraction <= 0:
        return ""
    cut = int(len(text) * fraction)
    if cut < len(text) and not text[cut].isspace():
        cut = text.rfind(" ", 0, cut + 1)
        if cut < 0:
            return ""
    return text[:cut].rstrip()
