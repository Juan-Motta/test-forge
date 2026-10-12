# Feature: interruption-evidence

Branch: `feat/interruption-evidence` (chained on `feat/public-api-docs`). Delivery: feature-branch-chain.

## Objective
Make interruption runs prove what happened instead of assuming it: record Vivi's confirmation of
each correction, present the heard text as an estimate, and judge recall with criteria that accept
conservative answers.

## Why (review comments accepted by the user, 2026-10-12, verified in code/data)
1. The runner sends `playback.interrupted`, but the realtime client ignores the relayed
   `conversation.item.truncated` / `conversation.item.deleted`, so a run cannot show the
   correction was applied (run b2979c01 events: `caller_interrupted`, no confirmation).
2. `heardText` = played-audio fraction applied to characters, yet the judge prompt presents it as
   exactly what was heard (`judge/prompt.py:244`).
3. The scenario criterion "resumes near the last heard number" penalizes valid answers
   (restarting from a safe point, admitting uncertainty).
Out of scope: word/audio alignment, re-implementing the provider's correction, changing Vivi.

## Tasks
- [ ] T1 Backend: capture `conversation.item.truncated` / `.deleted` from the target and correlate
      by item id with each `playback.interrupted`; summary/transcript/live/judge fields; heard text
      marked approximate in the judge prompt + tolerance rule; README + skill guide — delegated
- [ ] T2 Frontend: transcript + live show "≈ heard" and confirmation status — delegated
- [x] T3 Update the interruption scenarios' criteria (pipeline + realtime copies) — inline

## Contract
- `summary.interruptions[]` adds `confirmation`: `"truncated" | "deleted" | null`,
  `confirmedAudioEndMs: int | null` (from the provider event), `confirmedAtMs: number | null`
  (run clock), per item reported (`items: [{itemId, sentAudioEndMs, confirmation,
  confirmedAudioEndMs}]`).
- Interrupted agent transcript rows add `heardTextEstimated: true` and `interruptionConfirmed:
  true | false`.
- Live WS: new message `interruptionConfirmed {tMs, agentTurn, itemId, kind, audioEndMs}`.
- Judge prompt: interrupted turns say "approximately heard (estimated from played audio)" and
  "correction confirmed by the agent's server: yes/no"; rule: do not penalize differences of a
  word or one item around the cut; judge claims clearly beyond the heard part.

## Progress
- T3 (inline, via API): both interruption scenarios (7d8b1fb0 pipeline, 78f6b4e4 realtime) now say
  (must 40) "does not claim to have communicated numbers the caller did not hear; may say it is not
  sure where it stopped" and (must 35) "resumes from a conservative point (at or before the last
  heard number) or admits it does not know and asks; never continues from an unheard number".
  Criterion ids and weights kept.
- T1/T2: delegated writers in progress.
