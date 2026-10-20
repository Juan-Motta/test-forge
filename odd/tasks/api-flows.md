# API flows

Objective: save reusable API flows, grouped by API, that agents can discover, read and run through an AI-first API, and that humans can build, run and understand in the UI.
Branch: `feat/api-flows` (from `main` at 0d666e6). Delivery: work-unit commits, then fast-forward into `main` on the user's word. Runners: backend `uv run pytest`, frontend `npx vitest run --maxWorkers=3`.

## Specs

- S1 (user, verbatim): "una opcion que sea por ejemplo api y que tenga scenarios agrupados tambien como scenarios pero esta vez agrupados por api"
- S2 (user, verbatim): "poder crear flujos para probar apis en donde puedo agregar base url y credenciales"
- S3 (user, verbatim): "un flujo es al menos una llamada a la api o pueden ser mas la idea es que por ejemplo puedo tener un flujo de consulta de productos en donde primero lleva una llamada con la api key para generar un jwt y luergo pasar ese jwt al sig endpoint para generar la consulta y llenar los diferentes campos"
- S4 (user, verbatim): "estos campos pueden ser estaticos, fijos o me gustaria poder llenarlos en base a una descripcion con ia para poder tener consultas mas dinamicas"
- S5 (user, verbatim): "poder ver el flujo con una ui que sea intuitiva facil de entender y poder ver el flujo y los datos y copiar las curls si deseo"
- S6 (user, verbatim): "por ahora checkeos explicitos"
- S7 (user, verbatim): "la idea de los flujos no es tanto evaluar un flujo si no guardarlos para contextualizar mas al agente y a la plataforma, es decir dar al agente opciones para probar sin que tenga que generar scripts y que esto sea reutilizable y de paso sirve como memoria para el agente y para el usuario mismo para entender los flujos"
- S8 (user, verbatim): "la api debe ser ai first es decir orientada para que un agente la pueda usar facilmente y bien documentada y la ui es para humanos"
- S9 (user, 2026-10-20): the UI follows the design canvas (artboards 06–09): one table of APIs; entering an API shows a small sidebar with its flows and the API's data, like a scenario group ("me gustaria poder tener un estilo como el de scenarios en donde solo tengo una tabla con las apis y cuando entro una pequena barra laterl mostrandome los scenarios y los datos").
- S10 (user, 2026-10-20, verbatim): "me gustaria que las credenciales se pueden ver, si las coloque ahi es por que las quiero usar, se deben guardar seguras si pero deberian poderse ver, por defecto pueden estar ocultas o sensuradas pero deberia existir una opcion como el ojito de las claves para verla". Assumptions on how:
  - Calls run on the backend.
  - Credentials are stored sealed at rest with `platform/secrets.py`.
  - Responses, run records and cURL previews mask them by default.
  - A dedicated reveal endpoint (`GET /api/apis/{id}/secrets`) returns the plain value on request, for any signed-in user or API key.
  - The UI shows an eye toggle wherever a credential appears (API header, credential field, step fields, run request, cURL). It fetches the value only when clicked and hides it again when toggled off or on leaving the page.
  - Copy cURL copies what is shown: masked, or revealed after the eye is clicked.
- S11 (assumption, refined in T1): an API has a name (unique), description, tags, base URL (https, or http to a local host, like text agents), plain default headers and up to 10 named secrets (sealed together). A flow has a name (unique within its API), description, inputs (name, type, description, default), ordered steps and linked agents.
- S12 (assumption, refined in T1): a step has method, path, query, headers and a JSON body whose string leaves are templates. Placeholders name their source: `{{input.<name>}}`, `{{secret.<name>}}` (the API's named secrets) and `{{saved.<name>}}` (a value an earlier step saved). Plain text is fixed. AI-generated values belong to inputs: an input with `generate` (a description) is written by AI when the run gives no value and it has no default. A step saves named values from its response with a dot path (`body.access_token`, `headers.x-token`, `status`).
- S13 (assumption, from S6): checks are explicit per step: status equals, a dot path exists or compares (`== != > < >= <=`, `length`), and duration under a limit. A run passes when every check passes, and it stops at the first failing step.
- S14 (assumption, AI-first, from S8):
  - Every endpoint has an OpenAPI summary, a description and examples.
  - A flow is readable as a self-describing contract (purpose, inputs with types and descriptions, steps, what each step saves, checks).
  - Running a flow is one call (`POST /api/flows/{id}/runs` with inputs) that returns the full per-step trace.
  - Errors are structured, with a field path and a reason.
  - Flows can be listed per agent, so an agent finds the flows meant for it.
  - The agent skill (`modules/skill/guide.md`) gets an "API flows" section.
- S15 (assumption): outbound calls go through the existing egress guard (`platform/egress.py`) with the same private-network policy as agent connections. Each step has a timeout, and response bodies kept in run records are capped in size.
- S16 (assumption): AI-generated values use the evaluator's chat connection. Each run records the generated value so it can be repeated.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1–S3, S10, S11, S14 | inline | done, verified (blocker fixed) | cbee3b8, fix in T2 commit |
| T2 | S3, S4, S6, S10, S12–S16 | inline | done, verifier pending | see L8 |
| T3 | S7, S8, S14 | inline | done | see L8 |
| T4 | S1, S2, S9 | inline | pending | |
| T5 | S3–S5, S9, S12, S13 | inline | pending | |
| T6 | S5, S9, S10 | inline | pending | |

- T1 Backend model and CRUD:
  - Tables `apis`, `api_flows` and `api_flow_agents`, migration 0017.
  - `/api/apis` CRUD, with the credential sealed at rest, masked in responses, and revealed by `GET /api/apis/{id}/secrets`.
  - `/api/flows` CRUD with `?apiId=` and `?agentId=`, and validation of step references (no reference to a later step or an unknown input).
  - OpenAPI docs with examples; tests.
- T2 Backend runner:
  - Template resolution, credential injection, extraction, checks, timeouts, egress guard, masking and AI values.
  - Table `api_flow_runs` (per-step request/response, masked and capped).
  - `POST /api/flows/{id}/runs`, `GET /api/flows/{id}/runs`, `GET /api/flow-runs/{id}`, and `GET /api/flows/{id}/curl` (masked unless `?reveal=true`).
  - Tests, including a local HTTP stub.
- T3 AI-first docs: the skill guide "API flows" section (discover, read, run, interpret, errors), an agent-facing contract view of a flow, and a review of OpenAPI descriptions.
- T4 Frontend: a nav item, the API table (filters, pagination, Run all, New flow), the API page (title, description, connection, tags, flows rail, "Select a flow" placeholder with Run all), and New API.
- T5 Frontend flow editor: inputs; steps with method, path and fields; a value-source chip per field; saved values; checks; Copy cURL per step; agents used by; save.
- T6 Frontend run view (steps strip, request and response, eye toggle on credentials, Copy cURL of what is shown, checks, values), runs history in the flow, and the user guide EN/ES. The eye toggle itself is a shared UI piece built in T4.

Route evidence: the units are sequential (T2 needs T1; T4–T6 need T1–T2), so there is no Writer trigger and the parent works inline. T1 and T2 touch high-risk item 2 (stored credentials and outbound requests to user-given URLs): an independent verifier runs after their checks.

## Log

- L1 (user, 2026-10-20, verbatim): "ok tengo una idea que me gustaria probar con una opcion que sea por ejemplo api y que tenga scenarios agrupados tambien como scenarios pero esta vez agrupados por api y la idea es poder crear flujos para probar apis en donde puedo agregar base url y credenciales y poder generar scenarios donde estos scenarios significan flujos de apis, de hecho el nombre mas correcto en lugar de scenarios seria flujos, un flujo es al menos una llamada a la api o pueden ser mas la idea es que por ejemplo puedo tener un flujo de consulta de productos en donde primero lleva una llamada con la api key para generar un jwt y luergo pasar ese jwt al sig endpoint para generar la consulta y llenar los diferentes campos, estos campos pueden ser estaticos, fijos o me gustaria poder llenarlos en base a una descripcion con ia para poder tener consultas mas dinamicas, ademas quiero poder ver el flujo con una ui que sea intuitiva facil de entender y poder ver el flujo y los datos y copiar las curls si deseo, como te parece?"
- L2 (user, 2026-10-20, verbatim): S6 and S7 (one message).
- L3: Design on the canvas (BjePefionoj7skYJHXvuBD), artboards 06 API flows, 07 API (no flow selected), 08 API flow, 09 API flow run; reworked to the scenarios style (S9); the user approved it: "ok se ve bien por ahora".
- L4 (user, 2026-10-20, verbatim): S8. Plan written; implementation awaits the user's go-ahead.
- L5 (user, 2026-10-20, verbatim): see S10. Credentials are no longer write-only: they are masked by default and revealed with an eye toggle (UI) or the reveal endpoint (API).
- L6: T1: module `apiflows` (domain, models, service, api), migration 0017 (apis, api_flows, api_flow_agents), `/api/apis` (CRUD, `/secrets` reveal) and `/api/flows` (CRUD, `?apiId`, `?agentId`, reference validation with field locations), OpenAPI summaries and examples. 30 new tests pass; full backend 1217 passed, 1 failed only because the shell exports VOICE_EVAL_MASTER_KEY (passes without it). The tests were written after the code (new module, no RED observed). Delivery strategy: the user's standing convention, work-unit commits on the branch, then fast-forward into main on the user's word.
- L7: Verifier on T1 (run against a `git archive` export of cbee3b8): S1, S2, S3, S10, S12 and S14 pass. Blocker: PATCH merged secrets past the cap of 10 (S11). Fixed: the cap is checked after the merge (422 at `["body", "secrets"]`), with a test. Advisories kept: removing a secret that a flow uses leaves the flow referencing it (the run then fails that step with "{{secret.x}} has no value"); API names are unique by exact case.
- L8: T2: `runner.py` (inputs given → default → AI, typed values, templates, steps in order stopping at the first failure, saves, checks, secrets hidden in records and echoed responses, capped bodies, safe transport errors including the egress guard), `ai.py` (one structured chat call writes the generated inputs), `runs.py` (`FlowRunner` on the app: guarded transport with `allow_private` in development, local hosts dialled via `LOCAL_TARGET_HOST`, the first chat connection by default), migration 0018 `api_flow_runs`, and routes `POST/GET /api/flows/{id}/runs`, `GET /api/flows/{id}/curl`, `GET /api/flow-runs/{id}` and `/steps/{n}/curl` (masked unless `?reveal=true`). `connections.runtime` gains `build_chat_client` and `first_chat_connection`. T3: the "API flows" section of the agent skill guide. Full backend suite: 1233 passed (with VOICE_EVAL_MASTER_KEY unset).
- Forecast: about 3,500 authored changed lines (backend ~1,600, frontend ~1,900), over the 400-line budget, so the delivery strategy is to be chosen before the first commit.
