"""Token usage of the evaluator's own model calls (the caller and the judge), for their cost.

Each adapter that calls a model keeps a `UsageMeter` as its `usage` attribute and adds what
every call reported, under the model the call was billed as (an Azure deployment counts as the
base model it deploys). The runner and the judge read the meters at the end (`collect_usage`;
a fake without a meter simply adds nothing) and store the plain dict:

    {"by_model": {<model>: {<bucket>: tokens, ...}}, "notes": [<code>, ...]}

Buckets are disjoint: `text_in` excludes the cached text tokens counted in `cached_text_in`
(audio likewise). `notes` flags usage that could not be metered exactly (see the codes below);
the pricing module turns them into "incomplete" cost notes.
"""

from typing import Any

BUCKETS = ("text_in", "cached_text_in", "audio_in", "cached_audio_in", "text_out", "audio_out")
# The speech endpoint returns no usage: its input is estimated, its audio output is not metered.
TTS_TEXT_ESTIMATED = "tts_text_estimated"
TTS_AUDIO_NOT_METERED = "tts_audio_not_metered"


def _count(value: Any) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return 0


class UsageMeter:
    def __init__(self) -> None:
        self.by_model: dict[str, dict[str, int]] = {}
        self.notes: set[str] = set()

    def __repr__(self) -> str:
        return f"UsageMeter({self.to_dict()!r})"

    def add(self, model: str, **counts: Any) -> None:
        """Add one call's token counts; unknown buckets and non-positive counts are ignored."""
        for bucket, value in counts.items():
            tokens = _count(value)
            if bucket in BUCKETS and tokens:
                buckets = self.by_model.setdefault(model, {})
                buckets[bucket] = buckets.get(bucket, 0) + tokens

    def note(self, code: str) -> None:
        self.notes.add(code)

    def to_dict(self) -> dict[str, Any] | None:
        """The stored shape, or None when nothing was metered."""
        if not self.by_model:
            return None
        usage: dict[str, Any] = {
            "by_model": {model: dict(buckets) for model, buckets in self.by_model.items()}
        }
        if self.notes:
            usage["notes"] = sorted(self.notes)
        return usage


def merge_usage(*usages: Any) -> dict[str, Any] | None:
    """The sum of stored usages (missing or malformed ones are skipped); None when empty."""
    meter = UsageMeter()
    for usage in usages:
        if not isinstance(usage, dict) or not isinstance(usage.get("by_model"), dict):
            continue
        for model, buckets in usage["by_model"].items():
            if isinstance(buckets, dict):
                meter.add(str(model), **{str(k): v for k, v in buckets.items()})
        notes = usage.get("notes")
        for code in notes if isinstance(notes, list) else []:
            if isinstance(code, str):
                meter.note(code)
    return meter.to_dict()


def collect_usage(*providers: Any) -> dict[str, Any] | None:
    """The merged usage of the providers' meters (those without one add nothing)."""
    meters = [getattr(provider, "usage", None) for provider in providers]
    return merge_usage(*(m.to_dict() for m in meters if isinstance(m, UsageMeter)))


def usage_since(before: Any, after: Any) -> dict[str, Any] | None:
    """What a meter added between two `to_dict()` readings (`after` minus `before`), for a
    model reused across calls; notes present `after` are kept. None when nothing was added."""
    earlier = merge_usage(before) or {"by_model": {}}
    later = merge_usage(after)
    if later is None:
        return None
    meter = UsageMeter()
    for model, buckets in later["by_model"].items():
        spent = earlier["by_model"].get(model, {})
        meter.add(
            model, **{bucket: tokens - spent.get(bucket, 0) for bucket, tokens in buckets.items()}
        )
    for code in later.get("notes", []):
        meter.note(code)
    return meter.to_dict()
