# Scenario groups

Objective: scenarios live in groups (folders) with a title, description and tags; Scenarios lists the groups.
Branch: `feat/scenario-groups` (from `main` at d008bc7). Delivery: work-unit commits, then fast-forward into `main` on the user's word. Runners: backend `uv run pytest`, frontend `npx vitest run --maxWorkers=4`.

## Specs

- S1 (user, verbatim): "un scenario es individual como hoy sucede, pero quiero poder agrupar scenarios"
- S2 (user, verbatim): "la tabla de scenarios deberia poderse ver como los grupos de scenarios y el boton deberia ser nuevo grupo"
- S3 (user, verbatim): "una ves se crea el grupo se deberia mostrar la vista ya existente con el sidebar de scenarios y los datos del detalle"
- S4 (user, verbatim): "el grupo de scenario deberia tener titulo, detalle y tags"
- S5 (user decision 2026-10-19): group model "Folder, mixed agents": each scenario lives in exactly one group; a group can hold scenarios of different agents.
- S6 (user decision 2026-10-19): existing scenarios: "One group per agent": every scenario must be in a group; the migration creates one group per agent, named after the agent, holding its current scenarios.
- S7 (assumption, keeps the API compatible): `groupId` is optional when creating a scenario through the API; without it the scenario goes to the group named after its agent (created if missing). The UI always sends it.
- S8 (assumption): a group can be deleted only when it has no scenarios (409 otherwise), like an agent in use. Group titles are unique.
- S9 (assumption): scenario names stay unique per agent (unchanged).

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S4–S9 | inline | pending | |
| T2 | S2 | inline | pending | |
| T3 | S3, S5 | inline | pending | |
| T4 | all | inline | pending | |

- T1 Backend: `scenario_groups` table and migration 0016 (create, backfill one group per agent, `scenarios.group_id` NOT NULL FK RESTRICT); `/api/scenario-groups` CRUD with scenario counts and agents; scenarios carry `groupId`/`group`, filter `?groupId=`, move between groups; tests; skill guide.
- T2 Frontend: Scenarios lists groups (title, description, tags, scenario count, agents, last updated, quick actions); "New group" dialog (title, description, tags) that opens the new group.
- T3 Frontend: group page with the scenarios sidebar (the group's scenarios) and the group's details (edit, delete when empty); scenario editor gets a Group field, rail follows the scenario's group; new scenario preselects `?group=`; export/import carry the group by name.
- T4 Docs: user guide (EN/ES), agent skill; full suites.

Route evidence: no Writer trigger (units are sequential: T2–T3 depend on T1), so the parent works inline. T1 touches high-risk item 1 (migration with backfill of stored data): independent verifier after its checks.

## Log

- L1 (user, 2026-10-19, verbatim): "quiero ajustar cosas, los scenarios no se entienden bien, por ello quiero hacer un revamp, un scenario es individual como hoy sucede, pero quiero poder agrupar scenarios, entonces la tabla de scenarios deberia poderse ver como los grupos de scenarios y el boton deberia ser nuevo grupo, una ves se crea el grupo se deberia mostrar la vista ya existente con el sidebar de scenarios y los datos del detalle, el grupo de scenario deberia tener titulo, detalle y tags"
- L2: Decisions S5, S6 taken by the user through two questions. Backend map: migrations 0001–0015 never backfilled data with SQL; 0016 is the first. Tests TRUNCATE an explicit table list (`tests/conftest.py:607`).
