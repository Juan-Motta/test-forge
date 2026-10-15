<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## i18n (English / Spanish)

UI copy lives in `src/lib/i18n/messages/{en,es}.ts`: flat dotted keys grouped by area (`nav.runs`,
`login.title`, `runs.notStarted`). `en.ts` is the source of the keys; `es.ts` is typed `Messages`, so a
missing or extra Spanish key is a compile error, and `messages.test.ts` checks key and placeholder parity.
Spanish is neutral and addresses the reader as "tú".

- Client components: `const t = useT()` then `t("area.key", { name })`; plurals are `<key>.one` /
  `<key>.other` read with `t.plural("area.key", count, vars)` (`{count}` is filled in).
- Server components (no hooks): `<T k="area.key" vars={...} />` for short text inside client-rendered UI,
  or `getTranslator()` (below).
- Dates and numbers: `useFormat()` (`relativeTime`, `absoluteTime`, `usd`, `number`) instead of hard-coded
  `Intl.*("en")`. English output is unchanged.
- Never translate data: scenario names, transcripts, evidence quotes, ids.
- Tests: `renderWithClient(ui, { locale: "es" })` renders in Spanish; English is the default, so English
  assertions keep working. Plain `render` also reads English (the context falls back to it).
- Language switch: `LanguageControl` (`features/shell`) writes the `voice-eval-locale` cookie and refreshes.
- Server components and `generateMetadata`: `const t = await getTranslator()` (`@/lib/i18n/server`, reads the
  `app/[lang]` root param), e.g. translated page titles. Long server-only copy (the guide) belongs here so it
  is not shipped to the browser.

### How the language reaches the server

Every page lives under `app/[lang]/` and is prerendered once per language (`generateStaticParams` in the root
layout). URLs carry no language: `src/proxy.ts` rewrites `/runs` to `/<locale>/runs`, choosing the
`voice-eval-locale` cookie, else `Accept-Language`, else `en`; `<html lang>` comes from the root param. Links
and `usePathname()` keep the clean URL. New routes go under `app/[lang]/` and their `PageProps`/`LayoutProps`
strings start with `/[lang]`.

Caveat: the prerendered HTML is served with `Cache-Control: s-maxage=…` and Next does not let the proxy add
`Vary: Cookie, Accept-Language`, so a shared cache (CDN, reverse proxy cache) in front of Next would serve one
language to everyone. Do not put one in front without keying it on the cookie and `Accept-Language` (or
bypassing it for HTML).
