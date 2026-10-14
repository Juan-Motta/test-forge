import type { ReactNode } from "react";
import { GuidePage } from "@/features/guide/GuidePage";
import { KpiMockup, VerdictMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, GuideLink, P, Region, Table, Ui } from "@/features/guide/prose";
import { guideMetadata } from "@/features/guide/sections";

export const metadata = guideMetadata("modules");

const MODULES = [
  ["overview", "Overview"],
  ["live-sessions", "Live sessions"],
  ["runs-and-reports", "Runs & reports"],
  ["scenarios", "Scenarios"],
  ["agents", "Agents"],
  ["connections", "Connections"],
  ["api-keys", "API keys"],
  ["api-docs-and-skill", "API docs and agent skill"],
] as const;

function Tips({ children }: { children: ReactNode }) {
  return (
    <Callout tone="tip" title="Tips">
      <Bullets>{children}</Bullets>
    </Callout>
  );
}

export default function ModulesPage() {
  return (
    <GuidePage slug="modules">
      <P>
        The sidebar of the app lists every module. This page explains each one: what it is for, what you will find there, and
        a few tips. Jump to one:
      </P>
      <nav aria-label="Modules on this page">
        <ul className="flex flex-wrap gap-2">
          {MODULES.map(([id, title]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-9 items-center rounded-full border border-field-line px-3 text-sm text-body no-underline hover:border-line-strong hover:text-fg"
              >
                {title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Region id="overview" title="Overview">
        <P>
          The home page: how your agents did over the last 7 days, at a glance. It is empty until the first run, and then
          shows:
        </P>
        <Bullets>
          <li>
            <Ui>Key metrics</Ui>: runs in the last 7 days (compared with the week before), the average judge score, goal
            completion (the share of judged runs whose must criteria all passed) and the agent&apos;s median reply latency.
          </li>
          <li>
            <Ui>Live now</Ui>: runs in progress, with <Ui>Listen in</Ui> for calls and <Ui>Watch</Ui> for text
            conversations.
          </li>
          <li>
            <Ui>Recent runs</Ui>, filtered by <Ui>All</Ui>, <Ui>Failed</Ui> or <Ui>Needs review</Ui> (a must criterion failed,
            or the score is under 60).
          </li>
          <li>
            <Ui>Weakest criteria</Ui>, the criteria with the lowest average scores, and <Ui>Suggestions ready for handoff</Ui>.
          </li>
        </Bullets>
        <KpiMockup />
        <Tips>
          <li>Use the search box to find runs by scenario or thread ID.</li>
          <li>
            <Ui>New run</Ui> takes you to your scenarios to launch one.
          </li>
        </Tips>
      </Region>

      <Region id="live-sessions" title="Live sessions">
        <P>
          Watch runs as they happen, and listen to calls. Each run in progress is a card (calls show their recent audio
          levels); after a launch you land on the batch, with its progress. A text agent&apos;s run shows the chat streaming
          in instead: each reply as it is written, the tools it runs, and its time to the first text.
        </P>
        <Bullets>
          <li>
            <Ui>Live transcript</Ui>: what each side says, as it is said. Interruptions and barge-ins are marked.
          </li>
          <li>
            <Ui>Evaluator intent</Ui>: what the caller is about to say and why, before it says it. If the agent speaks again
            first, the decision is shown as discarded.
          </li>
          <li>
            <Ui>Evaluator goals</Ui>: the plan the judge will check after the call.
          </li>
          <li>
            <Ui>Call metrics</Ui>: average and slowest agent latency, turns and interruptions (for a text agent: time to
            the first text, messages and tools used).
          </li>
          <li>
            <Ui>Listen</Ui> (calls only) with an audio mix (both, agent only or evaluator only) and a volume control.
          </li>
        </Bullets>
        <P>
          Turn on <Ui>Follow and listen automatically</Ui> to have each run open as it starts and, for a call, play on its
          own. With runs in parallel it stays on the current one until it ends, then moves to the next run still in
          progress; you can still pick another card. Your browser remembers the choice. After a reload, the browser may
          need one click (on <Ui>Listen</Ui>) before it plays audio.
        </P>
        <Tips>
          <li>
            <Ui>End call</Ui> stops one call; <Ui>Stop all</Ui> ends every call of a batch and cancels the ones still queued.
            Finished runs keep their results.
          </li>
          <li>
            If you see <Ui>Audio skipped</Ui>, your connection fell behind: some audio was dropped for you, but the transcript
            is complete and the recording is not affected.
          </li>
        </Tips>
      </Region>

      <Region id="runs-and-reports" title="Runs & reports">
        <P>
          Every run ever made, newest first, with its transcript, timings and (for calls) audio. Filter by <Ui>Status</Ui> or{" "}
          <Ui>Scenario</Ui>; <Ui>Recent batches</Ui> shows how each launch is progressing.
        </P>
        <P>
          The table shows the scenario, agent (marked Voice or Text), persona, duration, turns (caller / agent), median latency, status, score and
          result. Open a run to see its report:
        </P>
        <VerdictMockup />
        <Table
          caption="Parts of a run report"
          head={["Part", "What it shows"]}
          rows={[
            ["Verdict", "Overall score, goals met, the judge's summary, failure tags and strengths."],
            ["Call recording", "The whole conversation as one recording (both voices on one timeline), audio lanes with issue markers, Download conversation .wav and the separate tracks."],
            ["Conversation (text agents)", "Instead of the recording: the mode, user messages and agent replies, time to the first text (median and slowest), full reply time, tools used and why the conversation ended."],
            ["Transcript & scorecard", "The conversation next to one row per criterion, with verdicts and links to the turns used as evidence. A text agent's transcript is a chat, with each reply's timings, its tools and replies that broke off."],
            ["Langfuse trace", "The agent's model calls, tool calls and errors during the call, as a timeline."],
            ["Suggestions", "Concrete changes to make, each with an area (prompt, tools, flow, latency, voice) and a priority."],
            ["Handoff", "A brief for a coding agent: copy it or download it as Markdown."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Re-run</Ui> launches the same scenario again, as it is now, in a new batch. It is a paid call, so the app asks
            first.
          </li>
          <li>
            <Ui>Re-judge</Ui> scores the same call again (for example after linking Langfuse); the new result replaces the old.
          </li>
          <li>Click an issue marker on the audio lanes, or an evidence reference, to jump to that moment in the transcript.</li>
          <li>
            <Ui>Copy thread ID</Ui> gives you the id to look up the call in your agent&apos;s own logs.
          </li>
        </Tips>
      </Region>

      <Region id="scenarios" title="Scenarios">
        <P>
          Your library of conversations. A scenario describes the user the evaluator plays, what it knows and wants, and how the
          judge scores the call. Filter by agent or tag, select several to <Ui>Launch selected</Ui>, or open one to edit it.
        </P>
        <Table
          caption="The scenario editor, section by section"
          head={["Section", "Key fields"]}
          rows={[
            ["1 · Target agent and context", "Name, tags, the agent under test, and context added on top of the agent's shared context."],
            ["2 · Persona the evaluator plays", "Persona name, locale (the caller speaks that language), voice override, temperament, notes."],
            ["3 · Goal and instructions", "Goal (the judge checks it), how to behave, and facts the caller knows (only revealed when asked)."],
            ["4 · Success criteria for the judge", "Up to 30 criteria: text, Must or Should, evidence source (transcript, timing or trace) and weight. Weights total 100."],
            ["5 · When the call ends", "Max duration (30–1800 s, default 360), max silence (5–120 s, default 15), and hang up when: goal met or goodbye said, goodbye said, or max duration reached. For a text agent: max turns (1–100 user messages, default 20) instead of max silence."],
            ["6 · Interruptions", "Voice agents only. Up to 10: which agent reply to cut and after how many seconds of it."],
            ["7 · Evaluator", "Pipeline or speech-to-speech, the realtime model, the evaluator voice connection and the evaluator model connection. For a text agent (section 6): only the evaluator model connection, which is required."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Duplicate</Ui> a good scenario to make a variant, like the same request from an angry caller.
          </li>
          <li>Use tags such as &ldquo;smoke&rdquo; or &ldquo;regression&rdquo; to launch the right group quickly.</li>
          <li>
            Write criteria the judge can check from the call: &ldquo;Confirms the card is blocked&rdquo; works better than
            &ldquo;Is helpful&rdquo;. See <GuideLink href="/guide/scoring#writing-criteria">writing good criteria</GuideLink>.
          </li>
        </Tips>
      </Region>

      <Region id="agents" title="Agents">
        <P>
          The agents you test: how to reach them and what they do. Each one is a voice agent (called over its WebSocket) or a
          text agent (reached over Vivi&apos;s channel API); the kind is chosen when the agent is added and cannot change.
          Scenarios are written against an agent, so add one first.
        </P>
        <Table
          caption="Agent fields"
          head={["Field", "What it is"]}
          rows={[
            ["Name", "Unique; scenarios and runs refer to the agent by it."],
            ["What this agent does", "Shared by all its scenarios; the evaluator and the judge read it before every run."],
            ["Agent kind", "Voice or Text, chosen when the agent is added."],
            ["Protocol", "Voice: Auto-detect (default), Live or Realtime."],
            ["WebSocket URL", <>The agent&apos;s address, <Code>wss://</Code>, without a query string. <Code>ws://</Code> is allowed for local addresses.</>],
            ["Channel ID, User ID", "Voice: sent when the call opens, like your own client does."],
            ["Base URL, Channel ID", <>Text: the address before <Code>/channelsApi</Code> (https; http only for local hosts) and the channel&apos;s UUID.</>],
            ["Mode", "Text: Stream (latency to the first text) or Invoke (latency to the full reply)."],
            ["Authentication", <>Text: None for a WEB channel such as the portal&apos;s testing channel, or API key (sent as <Code>vivi-api-key</Code>, write-only).</>],
            ["Origin (optional)", "Sent as the Origin header when your agent checks it."],
            ["Langfuse connection", "Optional. The agent's traces are fetched after each run and handed to the judge."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Import from cURL</Ui> fills in the connection fields from a request copied in your browser&apos;s developer
            tools. Name and context are not touched.
          </li>
          <li>
            <Ui>Run connection test</Ui> checks the agent answers before you spend money on runs. For a text agent it sends
            one short message, which reaches the agent.
          </li>
          <li>The evaluator and the judge are set per scenario, not per agent.</li>
          <li>An agent can only be deleted when no scenario uses it.</li>
        </Tips>
      </Region>

      <Region id="connections" title="Connections">
        <P>
          Under <Ui>Settings → Connections</Ui>: the credentials Duet uses to reach providers. Secrets are write-only: they are
          stored encrypted and only their last 4 characters are ever shown.
        </P>
        <Table
          caption="Connection providers"
          head={["Provider", "Used for"]}
          rows={[
            ["OpenAI", "The caller's voice, the caller's chat model, the realtime evaluator, and the judge."],
            ["Azure OpenAI", "The same, through your deployments: a TTS deployment, a chat deployment for the evaluator, and realtime deployments for speech-to-speech."],
            ["Azure AI Speech", "Can be stored, but cannot be used as the caller's voice yet."],
            ["Langfuse", "Reads your agent's traces so the judge can check tool calls, models and errors."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Test connection</Ui> checks the values against the provider. On a saved connection, leave the key blank to test
            the stored one.
          </li>
          <li>The provider of a connection cannot change; create a new connection instead.</li>
        </Tips>
      </Region>

      <Region id="api-keys" title="API keys">
        <P>
          Under <Ui>Settings → API keys</Ui>: keys let scripts, CI or an AI agent use Duet without signing in. A key acts as you.
        </P>
        <Bullets>
          <li>
            <Ui>Create API key</Ui>: give it a name (where it is used, like &ldquo;Nightly CI&rdquo;) and an expiry (never,
            30, 90 or 365 days).
          </li>
          <li>The full key is shown only once, right after you create it. Copy it into your CI secrets.</li>
          <li>The table shows when each key was created, last used and when it expires.</li>
          <li>
            <Ui>Revoke</Ui> stops a key immediately. This cannot be undone.
          </li>
        </Bullets>
      </Region>

      <Region id="api-docs-and-skill" title="API docs and agent skill">
        <P>
          <Ui>API docs</Ui> in the sidebar opens the Swagger reference at <Code>/api/docs</Code>: every endpoint, its fields and
          its responses, readable without signing in. The <Ui>Agent skill</Ui> card on the API keys page gives an AI agent
          everything it needs to use the API: concepts, flows and how to read results.
        </P>
        <P>
          How to put these together is explained in <GuideLink href="/guide/automation">Automation</GuideLink>.
        </P>
      </Region>
    </GuidePage>
  );
}
