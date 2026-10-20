# Navigation groups

Objective: group the sidebar into Agents and API with sub-items, add an all-flows page, and let Runs & reports list API flow runs too, with a type filter.
Branch: `feat/nav-groups` (from `main` at c7d9e19). Delivery: work-unit commits, then fast-forward into `main` on the user's word. Runners: backend `env -u VOICE_EVAL_MASTER_KEY uv run pytest -q`, frontend `npx vitest run --maxWorkers=3`.

## Specs

- S1 (user, verbatim): "tener dos nuevos grupos. En este caso, tener el grupo de agents y tener el grupo de API, y dentro de esas opciones que se puedan desprender unos submenús"
- S2 (user decision 2026-10-20): Agents → Conexiones (`/agents`) and Escenarios (`/scenarios`). API → Conexiones (`/apis`) and Flows (a new page `/flows` with every flow of every API). Groups expand and collapse, and are open while one of their pages is current. Overview, Live sessions, Runs & reports and Settings stay as they are.
- S3 (user, verbatim): "no qiero runs en agents, de hecho runs y reports me gustaria que siga como esta ahora solo que se debera agregar ahora un filtro para distinguir las corridas en caso que se quiera filtrar"
- S4 (user decision 2026-10-20): Runs & reports lists agent runs and API flow runs, with a Type filter: All / Agents / API flows. A flow run opens its existing run view.
- S5 (assumption): with Type = Agents, the page behaves exactly as today (same filters, pagination and URL). The status, scenario and batch filters apply to agent runs; with API flows, the filters are flow status (passed/failed) and API. All is newest first; it is capped at the first 200 of each kind and says so.
- S6 (assumption): `/flows` is a table of every flow: name, API, step methods, agents, last run (status and time), and actions to open or run it. It has search, API and agent filters and 20 rows per page, like the APIs table.
- S7 (assumption): the backend gains `GET /api/flow-runs` (paginated `{items, total}`, newest first, filters `status`, `apiId`, `flowId`; each item has its flow and API names and no step bodies), and `GET /api/flows` items gain `lastRun` (`{id, status, createdAt, durationMs}` or null). Both are additive.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S4, S5, S7 | inline | done | see L3 |
| T2 | S1, S2 | delegated | done | see L5 |
| T3 | S2, S6 | delegated | done | see L5 |
| T4 | S3, S4, S5 | delegated | done | see L5 |

- T1 Backend: `GET /api/flow-runs` with summaries, and `lastRun` on flows; tests; skill guide line.
- T2 Frontend: sidebar groups (expandable, open on their current page, keyboard and screen-reader friendly), on desktop and in the mobile drawer.
- T3 Frontend: `/flows` page.
- T4 Frontend: Type filter on Runs & reports, a flow-run row style, and links to the run view.

Route evidence: T2–T4 share the i18n message files and run after T1, so one writer does them in sequence (context backstop); T1 stays inline. No high-risk item: additive endpoints and UI only.

## Log

- L1 (user, 2026-10-20, verbatim): "Me gustaría empezar a realizar un pequeño ajuste en cómo estamos definiendo la barra lateral en la UI. Actualmente tenemos tres opciones, escenarios, API flows y agents. Me gustaría poder cambiar esa distribución y tener dos nuevos grupos. En este caso, tener el grupo de agents y tener el grupo de API, y dentro de esas opciones que se puedan desprender unos submenús. En el caso para ambas, digamos para agents, me gustaría tener la opción de conexiones y tener la opción de escenarios y runs. Y para API me gustaría tener la opción de conexiones y de flows, de tal manera que en lugar de tener las opciones separadas, puedo tener esas opciones agrupadas. Entonces así puedo pues organizar todo de una manera mucho, mucho más organizada. Entonces me gustaría que me ayudaras en esa parte."
- L2: S2–S4 confirmed by the user through two questions.
- L3: T1: `GET /api/flow-runs` (summaries, `{items,total}`, filters status/apiId/flowId, limit ≤200) and `lastRun` on flows (DISTINCT ON newest run). 62 apiflows tests pass; skill guide updated.
- L4: Native review of T1 approved and acknowledged; advisories fixed in 0783246 (step count in SQL, failed-status filter test).
- L5: T2–T4 (one writer): sidebar groups with per-group collapse memory, /flows page, Runs & reports Type filter (agents default unchanged, flows, all capped at 200 per kind). Frontend 961 passed, tsc and eslint clean. Not checked in a browser.
