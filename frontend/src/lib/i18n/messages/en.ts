/**
 * English messages: the source of truth for the keys. Flat dotted keys, grouped by area
 * (`<area>.<name>`). `{name}` is a placeholder; plural messages come as `<key>.one` / `<key>.other`.
 */
export const en = {
  // Built-in strings of the shared components (`src/ui`).
  "ui.copy": "Copy",
  "ui.copied": "Copied",
  "ui.copyFailed": "Copy failed",
  "ui.showSecret": "Show {subject}",
  "ui.hideSecret": "Hide {subject}",
  "ui.password": "password",
  "ui.notScored": "Not scored",
  "ui.issue": "Issue {n}",
  "ui.issues": "Issues",
  "ui.audioLevels": "{label} audio levels",
  "ui.loading": "Loading",

  "format.justNow": "just now",

  "theme.label": "Theme",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",

  "language.label": "Language",
  "language.en": "EN",
  "language.es": "ES",

  "nav.primary": "Primary",
  "nav.overview": "Overview",
  "nav.live": "Live sessions",
  "nav.runs": "Runs & reports",
  "nav.scenarios": "Scenarios",
  "nav.agents": "Agents",
  "nav.settings": "Settings",
  "nav.connections": "Connections",
  "nav.apiKeys": "API keys",
  "nav.apiDocs": "API docs",
  "nav.apiDocsNewTab": "API docs (opens in a new tab)",
  "nav.guide": "User guide",
  "nav.activeRuns.one": "{label} ({count} active)",
  "nav.activeRuns.other": "{label} ({count} active)",

  "shell.tagline": "Agent evals",
  "shell.environment": "Environment · {label}",
  "shell.openNavigation": "Open navigation",
  "shell.closeNavigation": "Close navigation",
  "shell.signOutFailed": "Could not sign out. Try again.",

  "account.unavailable": "Account details unavailable",
  "account.loading": "Loading account",
  "account.signOut": "Sign out",
  "account.signingOut": "Signing out…",

  "login.metaTitle": "Sign in",
  "login.title": "Sign in to Duet",
  "login.subtitle": "Use the account your administrator created for you.",
  "login.guideLink": "New here? Read the guide",

  "guideHeader.skip": "Skip to content",
  "guideHeader.home": "Duet guide home",
  "guideHeader.badge": "Guide",
  "guideHeader.links": "Guide links",
  "guideHeader.apiNewTab": "API reference (Swagger) (opens in a new tab)",
  "guideHeader.apiShort": "API",
  "guideHeader.api": "API reference (Swagger)",
  "guideHeader.openAppShort": "Open app",
  "guideHeader.openApp": "Open the app",

  "runs.notStarted": "Not started",
  "runs.queued": "queued",
} as const;
