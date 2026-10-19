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
- S10 (user, verbatim): "en la vista de scenarios el nuevo scenario deberia crear un nuevo grupo de scenarios en blanco en donde el titulo deberia pdoer ser editable por ejemplo correo ara reprogramar... deberia ser new scenario y la barra lateral izq deberia estar con un placeholder mientras se guarda"
- S11 (user, verbatim): "cuando entreo a un scenario en el titulo deberia mostrarse el nombre del grupo de scenarios y un icono al final del titulo para editar el nombre como un lapiz o algo"
- S13 (user, verbatim): "quitemos la opcion de group y el form de group, por defecto como estamos agrupando ya es un group, y quedamos que el titulo tenga un boton para editar un icono al final del titulo, la descripcion me gustaria que apareciera debajo del titulo con un boton al final para editarlo tambien e icono y debajo de la descripcion una opcion para agregar tags y cuando se abra por defecto deberia mostrar un placeholder en blanco diciendo que seleccione un scenario o un boton de correr todo similar a con live sessions por ejemplo cuandoe sta en blanco"
- S14 (assumption): "la opcion de group" is the sidebar's GROUP card; the editor's Group field stays (the only way to move a scenario). An empty group is deleted from a header button.
- S12 (assumption): a new group's title left empty takes the scenario's name; the group is created when the scenario is first saved (and removed again if that save fails).

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S4–S9 | inline | done, verified | e1a5d99, c3f3014 |
| T2 | S2 | inline | done | 3ff47c4 |
| T3 | S3, S5 | inline | done | 17acc6a |
| T4 | all | inline | done | b2de159 |
| T6 | S13, S14 | inline | done | 95543b3 |
| T5 | S10–S12 | inline | done | 0514af4 |

- T1 Backend: `scenario_groups` table and migration 0016 (create, backfill one group per agent, `scenarios.group_id` NOT NULL FK RESTRICT); `/api/scenario-groups` CRUD with scenario counts and agents; scenarios carry `groupId`/`group`, filter `?groupId=`, move between groups; tests; skill guide.
- T2 Frontend: Scenarios lists groups (title, description, tags, scenario count, agents, last updated, quick actions). Its "New group" dialog was replaced in T5 by New scenario starting a blank group.
- T3 Frontend: group page with the scenarios sidebar (the group's scenarios) and the group's details (edit, delete when empty); scenario editor gets a Group field, rail follows the scenario's group; new scenario preselects `?group=`; export/import carry the group by name.
- T4 Docs: user guide (EN/ES), agent skill; full suites.
- T6 Frontend: no sidebar group card and no group details form; title, description and tags edited in place under the title (group page and editor); the group page opens on a "Select a scenario" placeholder with Run all.
- T5 Frontend: Scenarios' main button is New scenario again; the editor's title is the group's name with a pencil to rename it inline; a new scenario outside a group starts a blank group (editable title, sidebar placeholder) created on save.

Route evidence: no Writer trigger (units are sequential: T2–T3 depend on T1), so the parent works inline. T1 touches high-risk item 1 (migration with backfill of stored data): independent verifier after its checks.

## Log

- L1 (user, 2026-10-19, verbatim): "quiero ajustar cosas, los scenarios no se entienden bien, por ello quiero hacer un revamp, un scenario es individual como hoy sucede, pero quiero poder agrupar scenarios, entonces la tabla de scenarios deberia poderse ver como los grupos de scenarios y el boton deberia ser nuevo grupo, una ves se crea el grupo se deberia mostrar la vista ya existente con el sidebar de scenarios y los datos del detalle, el grupo de scenario deberia tener titulo, detalle y tags"
- L2: Decisions S5, S6 taken by the user through two questions. Backend map: migrations 0001–0015 never backfilled data with SQL; 0016 is the first. Tests TRUNCATE an explicit table list (`tests/conftest.py:607`).
- L3: T1 e1a5d99: migration 0016 (first SQL backfill), `/api/scenario-groups` CRUD, scenarios `groupId`/`group`, `?groupId=`. Backend suite 1187 passed; migration test checks the backfill on real rows and the round trip to 0015; models match migrations.
- L4: Verifier on T1: S1, S4–S6, S8, S9 pass; blocker B1: concurrent first scenarios of an agent without a group raced to create its group (5 of 6 parallel POSTs returned 500). Fixed in c3f3014 with INSERT … ON CONFLICT DO NOTHING; regression test RED before, GREEN after. Advisories: default group matched by name (document it); `groupId` typed nullable in OpenAPI.
- L5: T2 3ff47c4: groups table (title, description, tags, count, agents, latest change, launch, new scenario in group), New group dialog (GroupForm) opening `/scenarios/groups/{id}`. Frontend suite 843 passed.
- L6: T3 17acc6a: `/scenarios/groups/[id]` (sidebar of the group's scenarios, details form, delete only when empty, launch all); editor Group field, rail and breadcrumb follow the scenario's group, `?group=` preselects, editor waits for groups; transfer carries the group by name. Frontend suite 850 passed.
- L7: T4 b2de159: user guide (EN/ES) and its test describe groups; skill guide updated in T1. Backend 1188 passed (incl. race test), frontend 850 passed. Pending: native review of the branch, local stack rebuild (runs migration 0016 on local data) on the user's word, merge into main on the user's word.
- L8: Native review of the branch (escalated to high for migration 0016; lenses risk, resilience, reliability): APPROVED and acknowledged. Fixed in 66a1530: launch offered only once scenarios loaded (error + retry otherwise); vanished agent → 422; group move pinned by a test. Advisories kept: NOT NULL in the same step as the backfill (single-instance deploy restarts, so no old writer remains); default group matched by name (S7, documented).
- L9 (user, 2026-10-19, verbatim): "ahora en la vista de scenarios el nuevo scenario deberia crear un nuevo grupo de scenarios en blanco en donde el titulo deberia pdoer ser editable por ejemplo correo ara reprogramar... deberia ser new scenario y la barra lateral izq deberia estar con un placeholder mientras se guarda, cuando entreo a un scenario en el titulo deberia mostrarse el nombre del grupo de scenarios y un icono al final del titulo para editar el nombre como un lapiz o algo," (S10, S11; T5 added).
- L10: T5 0514af4: Scenarios offers New scenario (no New group dialog); editor title is the group name with a pencil (EditableTitle; PATCH name, 409 inline); a new scenario outside a group shows a placeholder rail and an editable title, creates the group on first save (title or scenario name) and deletes it if the scenario fails; breadcrumb is just Scenarios. Frontend suite 854 passed (ScenarioEditor 422-mapping test flaky under 4 workers, passes alone).
- L11 (user, 2026-10-19, verbatim): see S13 (T6 added).
- L12: T6 95543b3: sidebar group card and group details form removed; group page and editor headed by title (pencil), description (pencil, Ctrl/Cmd+Enter) and tags (Add tag, remove ×), each saved in place (drafts for a new group, sent on creation); group page main area is a "Select a scenario" placeholder with Run all and New scenario; empty group deleted from the header. Frontend suite 854 passed.
- L13: Native review of T5+T6 (the whole unpushed range exceeds the review budget, so the unreviewed slice since 2ae69c1 was reviewed alone): APPROVED. Fixed in 29c9c2f: description saved once (in-flight guard), tag edits built on the local list and saved in order, rollback of an unused new group awaited, useId for the title error, stale import note and guide wording. Frontend suite 856 passed.
