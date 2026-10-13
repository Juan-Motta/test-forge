# Feature: user-guide

Branch: `feat/user-guide` (from `main`). Delivery: fast-forward into `main` and push (user keeps
everything on `main`).

## Objective
A visual, human-oriented guide to Duet, beside the technical Swagger: what the platform does,
getting started, the end-to-end flow, and what every module does, explained in detail and simply.

## Decisions (2026-10-12)
- Lives in the web app as a public route `/guide` (no login, like `/api/docs`), in Duet's visual
  language, versioned with the code. Linked from the app sidebar and the login page.
- English, like the rest of the UI.
- Diagrams are built in code (SVG/CSS with the design tokens), no external images.

## Sections
1. Overview: what Duet is, who it is for, the evaluator-as-caller idea.
2. Getting started: run the stack, sign in, add connections, add an agent (cURL import, test
   connection), write a scenario, launch, watch live, read the report.
3. How it works: the flow scenario → batch → run (evaluator ↔ agent) → artifacts → judge →
   report, with a diagram; run lifecycle states.
4. Modules: Overview, Live sessions, Runs & reports, Scenarios, Agents, Connections, API keys,
   API docs/agent skill — what each does, key fields, tips.
5. Scoring: criteria, weights, must criteria, bands 1–5 → 0–100, verdicts, issue labels,
   unobservable criteria, 3-sample median, timing.
6. Interruptions (barge-in) and evaluator modes (pipeline vs realtime, models, hang-up).
7. Automation: API keys, Swagger, agent skill.
8. Troubleshooting / FAQ.

## Tasks
- [x] T1 Guide route, layout with section nav, content and diagrams, links, tests — delegated
- [ ] T2 Visual check in the browser (desktop + phone width) — inline
- [ ] T3 Review, fast-forward `main`, push — inline

## Progress
- T1 (delegated writer, 2026-10-12): `/guide` + 7 sub-pages (static server components under
  `frontend/src/app/guide/`, shared pieces in `frontend/src/features/guide/`: sections, header,
  nav (sticky aside on lg, `<details>` menu on phones), page wrapper with prev/next, prose
  primitives, HTML diagrams (flow, run lifecycle, barge-in, judge samples) and inert mock-ups
  (verdict row, scorecard, launch panel, KPIs)). Route guard lets `/guide` and `/guide/*` through
  without a session; sidebar "User guide" link after "API docs"; login "New here? Read the guide".
  Titles `<Section> · Duet guide` (absolute). RED observed first (6 failing tests + 2 missing
  modules). Checks: vitest 584/584, lint clean, typecheck clean, build prerenders all 8 guide
  pages as static. Not committed (parent commits).
