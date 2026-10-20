import type { ReactNode } from "react";
import { ApiFlowRunMockup, KpiMockup, VerdictMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, GuideLink, P, Region, Table, Ui } from "@/features/guide/prose";

const MODULES = [
  ["overview", "Overview"],
  ["live-sessions", "Live sessions"],
  ["runs-and-reports", "Runs & reports"],
  ["scenarios", "Scenarios"],
  ["api-flows", "API flows"],
  ["agents", "Agents"],
  ["connections", "Connections"],
  ["api-keys", "API keys"],
  ["model-prices", "Model prices"],
  ["api-docs-and-skill", "API docs and agent skill"],
] as const;

function Tips({ children }: { children: ReactNode }) {
  return (
    <Callout locale="en" tone="tip" title="Tips">
      <Bullets>{children}</Bullets>
    </Callout>
  );
}

/** The English body of the "modules" guide page. */
export function ModulesEn() {
  return (
    <>
      <P>
        The sidebar of the app lists the main modules; Connections, API keys and Model prices are reached from{" "}
        <Ui>Settings</Ui>, which also holds your theme and language. This page explains each one: what it is for, what you will
        find there, and a few tips. Jump to one:
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
        <KpiMockup locale="en" />
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
            first, the decision is shown as discarded. The realtime evaluator decides as it speaks: its words appear in its
            bubble as they are said, and the full text replaces them once it has finished.
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
          <li>
            The run&apos;s full thread ID under its name, with a copy button, to look the call up in your agent&apos;s logs
            while it runs.
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
          Every run ever made, with its transcript, timings and (for calls) audio. Filter by <Ui>Status</Ui>,{" "}
          <Ui>Scenario</Ui> or <Ui>Batch</Ui> (one launch), and switch between <Ui>Newest first</Ui> and{" "}
          <Ui>Oldest first</Ui> beside the filters; the filters and the order are kept in the URL, so a link or a reload
          shows the same list. To watch a launch as it runs, open <Ui>Live sessions</Ui>.
        </P>
        <P>
          On wide screens (1280 px and up) the runs are a compact table. The <Ui>Scenario</Ui> cell holds the scenario name,
          with the agent, its kind (Voice or Text) and the persona under it; then come <Ui>Duration</Ui>, <Ui>Turns</Ui>{" "}
          (caller / agent), <Ui>p50 latency</Ui> and <Ui>Cost</Ui>; <Ui>Outcome</Ui> shows the score and the result, and
          the status only when the run did not complete normally (still in progress, failed, cancelled or interrupted);{" "}
          <Ui>Started</Ui> says when it began. <Ui>Live</Ui> and <Ui>Cancel</Ui> appear only for runs still in progress. On
          narrower screens each run is a card with the same figures, and the card keeps the full run ID with a copy button.
          Click a scenario name to open the run&apos;s report:
        </P>
        <VerdictMockup locale="en" />
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
            The report header shows the full thread ID with a copy button: use it to look up the call in your agent&apos;s own
            logs.
          </li>
          <li>
            <Ui>Open traces in Langfuse</Ui>, in the report header, opens Langfuse&apos;s trace list filtered on the run&apos;s
            thread ID, so you see every turn of the call. When that list is not available, the button reads{" "}
            <Ui>Open trace in Langfuse</Ui> and opens the single trace instead. It appears once the run has ended and its
            agent has a Langfuse connection.
          </li>
        </Tips>
      </Region>

      <Region id="scenarios" title="Scenarios">
        <P>
          Your library of conversations. A scenario describes the user the evaluator plays, what it knows and wants, and how the
          judge scores the call. Scenarios live in groups: folders with a title, a description and tags, which may hold
          scenarios of different agents. The page lists the groups with how many scenarios each holds, their agents and the
          latest change, twenty per page; search them by title, description or tag, or filter them by agent or tag. <Ui>New scenario</Ui> opens the editor on a new, blank group: name it with the pencil at the end of
          the title (or it takes the scenario&apos;s name), and it is created when you save. A group&apos;s page and every
          scenario in it are headed by the group&apos;s title, its description and its tags, each edited in place (the pencils,
          and <Ui>Add tag</Ui>), with the group&apos;s scenarios in the sidebar. Until you pick one, the group&apos;s page offers{" "}
          <Ui>Run all</Ui>; an empty group can be deleted from it. The scenario&apos;s <Ui>Group</Ui> field moves it to
          another group. Each group also launches all of
          its scenarios (play) or starts a new one in it (plus). In the editor, <Ui>Duplicate</Ui> and <Ui>Delete</Ui> (after a
          confirmation) act on the open scenario. Through the API, a scenario created without a group goes to the group named
          after its agent.
        </P>
        <Table
          caption="The scenario editor, section by section"
          head={["Section", "Key fields"]}
          rows={[
            ["1 · Target agent and context", "Name, tags, the agent under test, its group, and context added on top of the agent's shared context."],
            ["2 · Persona the evaluator plays", "Persona name, language (picked from a list; the caller speaks it), voice override (the voices of the chosen voice connection), temperament, notes."],
            ["3 · Goal and instructions", "Goal (the judge checks it), how to behave, and facts the caller knows (only revealed when asked)."],
            ["4 · Success criteria for the judge", "Up to 30 criteria: text, Must or Should, evidence source (transcript, timing or trace) and weight. Weights total 100."],
            ["5 · When the call ends", "Max duration (30–1800 s, default 360), max silence (5–120 s, default 15), and hang up when: goal met or goodbye said, goodbye said, or max duration reached. For a text agent: max turns (1–100 user messages, default 20) instead of max silence."],
            ["6 · Interruptions", "Voice agents only. Up to 10: which agent reply to cut and after how many seconds of it."],
            ["7 · Evaluator", "Pipeline or speech-to-speech, the realtime model, the evaluator voice connection and the evaluator model connection. For a text agent (section 6): only the evaluator model connection, which is required."],
          ]}
        />
        <Tips>
          <li>
            Duplicate a good scenario to make a variant, like the same request from an angry caller.
          </li>
          <li>
            <Ui>Export</Ui> (in an open scenario) shows it as text to copy or download as a <Code>.json</Code> file;{" "}
            <Ui>Import</Ui> (on this page or in a new scenario) pastes or loads that text to prefill a new scenario, which you
            review and save. The agent and the connections travel by name: ones this server lacks are listed for you to pick.
          </li>
          <li>Use tags such as &ldquo;smoke&rdquo; or &ldquo;regression&rdquo; to launch the right group quickly.</li>
          <li>
            Write criteria the judge can check from the call: &ldquo;Confirms the card is blocked&rdquo; works better than
            &ldquo;Is helpful&rdquo;. See <GuideLink href="/guide/scoring#writing-criteria">writing good criteria</GuideLink>.
          </li>
        </Tips>
      </Region>

      <Region id="api-flows" title="API flows">
        <P>
          Saved calls to the APIs your agents use, so people and agents can reuse them instead of writing scripts. An{" "}
          <Ui>API</Ui> holds a base URL, headers every call sends, and named secrets (an API key, a password), stored sealed. A{" "}
          <Ui>flow</Ui> is one or more calls in order: for example, get a token with the API key, then search products with
          that token. The page lists the APIs; open one to see its flows in the sidebar and its connection above them.
        </P>
        <Table
          caption="Where each value of a step comes from"
          head={["Chip", "What it means"]}
          rows={[
            ["Fixed", "Plain text, sent as written."],
            ["Flow input", <>A value given when the flow runs: <Code>{"{{input.name}}"}</Code>.</>],
            ["API secret", <>One of the API&apos;s secrets: <Code>{"{{secret.name}}"}</Code>. Masked in runs and cURLs.</>],
            ["From a step", <>A value an earlier step saved from its response: <Code>{"{{saved.name}}"}</Code>.</>],
            ["AI generated", "An input AI writes from its description when the run gives no value and it has no default."],
          ]}
        />
        <P>
          <Ui>Run flow</Ui> opens a small form, one field per input, filled with its default; leave an AI input empty and AI
          writes it. The run then shows each step as a strip: passed, failed or skipped, with its method, path, status and
          time. It opens on the first failed step, with its request, its response (JSON shown pretty), its checks with the
          actual value, and the values it saved. <Ui>Run all</Ui>, on an API and in its row of the table, runs every flow
          once with no inputs and lists how each ended.
        </P>
        <ApiFlowRunMockup locale="en" />
        <Tips>
          <li>
            Secrets show as <Code>apiKey ••••7890</Code>. The eye (<Ui>Show secrets</Ui>) shows the values; they are fetched
            only when you click it and hidden again when you click it again or leave the page.
          </li>
          <li>
            <Ui>Copy cURL</Ui> copies what you see: masked, or with the values while the eye shows them.
          </li>
          <li>
            Link a flow to the agents it is for. Agents find, read and run flows through the API: see the &ldquo;API
            flows&rdquo; section of the <GuideLink href="/guide/automation">agent skill</GuideLink>.
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
            <Ui>Export</Ui> shows an agent as text (never its API key); <Ui>Import</Ui> prefills a new agent from that text or
            its <Code>.json</Code> file, ready to review and create.
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
          Under <Ui>Settings → Connections</Ui>: the credentials TestForge uses to reach providers. Secrets are write-only: they are
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
          Under <Ui>Settings → API keys</Ui>: keys let scripts, CI or an AI agent use TestForge without signing in. A key acts as you.
        </P>
        <Bullets>
          <li>
            <Ui>Create API key</Ui>: give it a name (where it is used, like &ldquo;Nightly CI&rdquo;) and an expiry (never,
            30, 90 or 365 days).
          </li>
          <li>The full key is shown only once, right after you create it. Copy it into your CI secrets.</li>
          <li>
            The table shows when each key was created, last used and when it expires. It lists the active keys; switch to{" "}
            <Ui>Revoked</Ui> or <Ui>All</Ui> (which also shows expired keys) above it.
          </li>
          <li>
            The trash icon on a key&apos;s row revokes it: after you confirm with <Ui>Revoke key</Ui>, the key stops working
            immediately. This cannot be undone.
          </li>
        </Bullets>
      </Region>

      <Region id="model-prices" title="Model prices">
        <P>
          Under <Ui>Settings → Model prices</Ui>: the token prices TestForge uses to estimate what each evaluation costs. Each run
          report shows the <Ui>Evaluation cost</Ui> (the evaluator plus the judge, never your agent) and the runs list a
          compact <Ui>Cost</Ui> column.
        </P>
        <Bullets>
          <li>
            Prices are USD per 1M tokens, per model and kind of token (text or audio, input, cached input or output). They
            start as OpenAI&apos;s published list prices; edit them to match your contract. Azure OpenAI may differ, so costs
            are approximate.
          </li>
          <li>
            The judge counts every sample of every judgement, re-judges included. Pipeline calls do not price the TTS audio
            (the speech endpoint reports no usage), so their cost ends with a <Code>+</Code>.
          </li>
          <li>Runs from before costs were recorded show a dash.</li>
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
    </>
  );
}
