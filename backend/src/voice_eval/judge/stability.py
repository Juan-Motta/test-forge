"""How stable repeated judgements of one run are: per criterion bands, spread and verdict flips.

Pure: takes the `JudgeResult`s of N judgements of the same evidence (`voice-eval
judge-stability`) and summarizes them; nothing is stored. A criterion's spread is its highest
band minus its lowest over the samples that judged it (`None` when none did); a flip is a
verdict change between consecutive samples (`not_observable` counts as a verdict, a criterion
absent from a sample as `missing`).
"""

from dataclasses import dataclass
from typing import Any

from voice_eval.judge.domain import JudgeResult

UNSTABLE_SPREAD = 2  # a band spread this wide crosses a verdict boundary
MISSING = "missing"
TEXT_WIDTH = 40


@dataclass(frozen=True)
class CriterionStability:
    criterion_id: str
    text: str
    kind: str
    bands: list[int | None]
    verdicts: list[str]
    min_band: int | None
    max_band: int | None
    spread: int | None
    flips: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "criterionId": self.criterion_id,
            "text": self.text,
            "kind": self.kind,
            "bands": self.bands,
            "verdicts": self.verdicts,
            "minBand": self.min_band,
            "maxBand": self.max_band,
            "spread": self.spread,
            "flips": self.flips,
        }


@dataclass(frozen=True)
class StabilityReport:
    samples: int
    criteria: list[CriterionStability]
    overall_scores: list[int | None]
    overall_spread: int | None
    overall_mean: float | None
    unstable_criteria: int  # criteria whose band spread is >= UNSTABLE_SPREAD

    def to_dict(self) -> dict[str, Any]:
        return {
            "samples": self.samples,
            "criteria": [c.to_dict() for c in self.criteria],
            "overall": {
                "scores": self.overall_scores,
                "spread": self.overall_spread,
                "mean": self.overall_mean,
            },
            "unstableCriteria": self.unstable_criteria,
        }


def _flips(verdicts: list[str]) -> int:
    return sum(1 for a, b in zip(verdicts, verdicts[1:], strict=False) if a != b)


def summarize_stability(results: list[JudgeResult]) -> StabilityReport:
    """Criteria in the order of the first result, then any that only later results carry."""
    order: dict[str, tuple[str, str]] = {}
    for result in results:
        for c in result.criteria:
            order.setdefault(c.criterion_id, (c.text, c.kind))

    criteria: list[CriterionStability] = []
    for criterion_id, (text, kind) in order.items():
        bands: list[int | None] = []
        verdicts: list[str] = []
        for result in results:
            found = next((c for c in result.criteria if c.criterion_id == criterion_id), None)
            bands.append(found.band if found is not None else None)
            verdicts.append(found.verdict if found is not None else MISSING)
        judged = [band for band in bands if band is not None]
        low, high = (min(judged), max(judged)) if judged else (None, None)
        criteria.append(
            CriterionStability(
                criterion_id=criterion_id,
                text=text,
                kind=kind,
                bands=bands,
                verdicts=verdicts,
                min_band=low,
                max_band=high,
                spread=high - low if high is not None and low is not None else None,
                flips=_flips(verdicts),
            )
        )

    scores = [result.overall_score for result in results]
    scored = [score for score in scores if score is not None]
    return StabilityReport(
        samples=len(results),
        criteria=criteria,
        overall_scores=scores,
        overall_spread=max(scored) - min(scored) if scored else None,
        overall_mean=round(sum(scored) / len(scored), 1) if scored else None,
        unstable_criteria=sum(
            1 for c in criteria if c.spread is not None and c.spread >= UNSTABLE_SPREAD
        ),
    )


def _cell(value: object) -> str:
    return "-" if value is None else str(value)


def _clip(text: str) -> str:
    return text if len(text) <= TEXT_WIDTH else text[: TEXT_WIDTH - 1] + "…"


def render_stability(report: StabilityReport) -> str:
    """A plain-text table: one row per criterion, then the overall scores."""
    header = ("criterion", "kind", "bands", "verdicts", "spread", "flips")
    rows = [
        (
            _clip(c.text),
            c.kind,
            " ".join(_cell(band) for band in c.bands),
            " ".join(c.verdicts),
            _cell(c.spread),
            str(c.flips),
        )
        for c in report.criteria
    ]
    widths = [max(len(row[i]) for row in [header, *rows]) for i in range(len(header))]
    lines = ["  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip()
             for row in [header, *rows]]  # fmt: skip
    scores = " ".join(_cell(score) for score in report.overall_scores)
    lines.append("")
    lines.append(
        f"overall: {scores} (spread {_cell(report.overall_spread)}, "
        f"mean {_cell(report.overall_mean)})"
    )
    lines.append(
        f"criteria with band spread >= {UNSTABLE_SPREAD}: "
        f"{report.unstable_criteria} of {len(report.criteria)}"
    )
    return "\n".join(lines)
