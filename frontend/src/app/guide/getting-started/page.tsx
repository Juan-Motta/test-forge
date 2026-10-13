import { GuidePage } from "@/features/guide/GuidePage";
import { LaunchPanelMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, GuideLink, H2, P, Step, Steps, Ui } from "@/features/guide/prose";
import { guideMetadata } from "@/features/guide/sections";
import { CodeBlock } from "@/ui";

export const metadata = guideMetadata("getting-started");

const RUN_STACK = `cp .env.example .env          # then fill in POSTGRES_PASSWORD and VOICE_EVAL_MASTER_KEY
docker compose up --build -d  # starts the database, backend, web app and proxy
docker compose exec backend voice-eval create-user --email you@example.com --display-name "You"`;

export default function GettingStartedPage() {
  return (
    <GuidePage slug="getting-started">
      <P>
        This page takes you from nothing to your first judged call. It follows the order the app expects: credentials first,
        then the agent, then a scenario, then a launch. Plan for about 20 minutes, most of it writing your first scenario.
      </P>

      <H2 id="before-you-start">Before you start</H2>
      <Bullets>
        <li>A voice agent that speaks over a WebSocket (the same connection your web or phone client uses).</li>
        <li>
          An <Ui>OpenAI</Ui> or <Ui>Azure OpenAI</Ui> account: Duet uses it for the caller&apos;s voice, the
          caller&apos;s brain and the judge.
        </li>
        <li>
          Optional: a <Ui>Langfuse</Ui> project where your agent writes its traces, so the judge can also check tool calls and
          errors.
        </li>
      </Bullets>

      <H2 id="run-duet">1. Run Duet</H2>
      <P>
        If someone already runs Duet for your team, skip to the next step. Otherwise, whoever manages the server starts it
        with Docker from the project folder:
      </P>
      <CodeBlock code={RUN_STACK} label="Commands to start Duet with Docker" tone="command" />
      <P>
        The last command creates the first user (there is no public sign-up) and asks for a password of at least 12
        characters. The web app is then at <Code>http://localhost:3000</Code>.
      </P>
      <Callout tone="warning" title="Use localhost">
        Open <Code>http://localhost:3000</Code>, not <Code>127.0.0.1</Code>: for safety the server only accepts sign-ins from
        the addresses it was configured with.
      </Callout>

      <H2 id="sign-in">2. Sign in</H2>
      <P>
        Sign in with the email and password your administrator created for you. You land on <Ui>Overview</Ui>, which stays
        empty until the first run.
      </P>

      <H2 id="add-connections">3. Add your connections</H2>
      <P>
        A connection holds the credentials Duet uses to reach a provider. Secrets are stored encrypted and are never shown
        again; only their last 4 characters appear as a hint.
      </P>
      <Steps>
        <Step title="Open Settings → Connections and choose Add connection.">
          Pick the <Ui>Provider</Ui>: OpenAI, Azure OpenAI, Azure AI Speech or Langfuse.
        </Step>
        <Step title="Give it a name and fill in its fields.">
          For OpenAI, the API key is enough; the defaults for the voice model and voice are fine. For Azure OpenAI, add the
          endpoint, the API version and your deployments (a TTS deployment for the voice, and a chat deployment if it will also
          be the caller&apos;s brain).
        </Step>
        <Step title="Press Test connection, then Create connection.">
          The test makes one small request to the provider and tells you right away if a key or address is wrong.
        </Step>
      </Steps>
      <Callout tone="tip">
        One OpenAI connection is enough to get started: it can be the caller&apos;s voice, its chat model and the judge.
        Add a Langfuse connection too if your agent writes traces there.
      </Callout>

      <H2 id="add-an-agent">4. Add your agent</H2>
      <P>
        The agent is the voice assistant you want to test. Go to <Ui>Agents</Ui> and choose <Ui>Add agent</Ui>.
      </P>
      <Steps>
        <Step title="Import from cURL (the quickest way).">
          In your browser, open your agent&apos;s web client, open the developer tools, find its WebSocket request in the
          Network tab, right-click it and copy it as cURL. Paste it into <Ui>Import from cURL</Ui> and press <Ui>Import</Ui>:
          the WebSocket URL, Channel ID, User ID and Origin are filled in for you.
        </Step>
        <Step title="Name it and describe what it does.">
          The description (<Ui>What this agent does</Ui>) is shared by every scenario for this agent: the evaluator and the
          judge read it before each call.
        </Step>
        <Step title="Leave Protocol on Auto-detect.">
          Duet works out on each run which voice protocol your agent speaks. Pick one only to skip that check.
        </Step>
        <Step title="Optionally link a Langfuse connection, then Create agent.">
          With Langfuse linked, the judge also reads the agent&apos;s traces for each call.
        </Step>
        <Step title="Press Run connection test.">
          Duet dials the agent like a real run, waits until the session is ready (at most 8 seconds) and hangs up without
          sending audio. You see each step and how long the connection took.
        </Step>
      </Steps>
      <Callout tone="note" title="Testing an agent on your own machine">
        Use <Code>ws://localhost:…</Code>: plain <Code>ws://</Code> works for local addresses. When Duet runs in Docker, it
        reaches your machine automatically.
      </Callout>

      <H2 id="write-a-scenario">5. Write your first scenario</H2>
      <P>
        A scenario is one kind of call. Go to <Ui>Scenarios</Ui> and choose <Ui>New scenario</Ui>. The editor has seven short
        sections:
      </P>
      <Steps>
        <Step title="Target agent and context">Choose the agent and, if needed, add context that only this scenario needs.</Step>
        <Step title="Persona the evaluator plays">
          A name, a locale such as <Code>en-US</Code> or <Code>es-MX</Code> (the caller speaks that language), a temperament
          such as polite, hurried or angry, and notes on habits.
        </Step>
        <Step title="Goal and instructions">
          What the caller wants (&ldquo;Get my lost card blocked&rdquo;), how they behave, and the facts they know, like the
          last four digits of the card. Facts are only revealed when the agent asks.
        </Step>
        <Step title="Success criteria for the judge">
          What a good call looks like, one sentence each, with a weight. Weights must add up to exactly 100. Mark the
          essential ones as <Ui>Must</Ui>.
        </Step>
        <Step title="When the call ends">The maximum duration, the maximum silence and when the caller hangs up.</Step>
        <Step title="Interruptions">Optional: make the caller cut the agent off mid-reply.</Step>
        <Step title="Evaluator">
          How the caller speaks. Keep <Ui>Pipeline</Ui>, choose your OpenAI or Azure OpenAI connection as the{" "}
          <Ui>Evaluator voice</Ui>, and leave the evaluator model on <Ui>Same as voice connection</Ui>.
        </Step>
      </Steps>
      <P>
        Press <Ui>Create scenario</Ui>. You can come back and edit it any time; past runs keep the version they were launched
        with.
      </P>

      <H2 id="launch">6. Launch</H2>
      <P>
        From the scenario (or from the list, with <Ui>Launch</Ui>), the launch panel asks how many runs to make and how many
        may run at the same time. It shows how many calls that is and a rough wall-time estimate.
      </P>
      <LaunchPanelMockup />
      <Callout tone="tip" title="Start small">
        Launch a single run first to check everything is wired up. Once it works, use 3 or more runs per scenario: one call is
        only a sample of one.
      </Callout>

      <H2 id="watch-live">7. Watch it live</H2>
      <P>
        After launching, open <Ui>Live sessions</Ui>. Each call in progress has a card; open one to see the live transcript,
        the evaluator&apos;s intent (what it is about to say, and why), and call metrics. Press <Ui>Listen</Ui> to hear it,
        and choose the agent, the evaluator or both. <Ui>End call</Ui> stops it early.
      </P>

      <H2 id="read-the-report">8. Read the report</H2>
      <P>
        When the call ends, the judge scores it automatically. It usually takes a few minutes, and up to about 20 with
        Langfuse (traces take a while to become available). Open the run from <Ui>Runs &amp; reports</Ui> to see:
      </P>
      <Bullets>
        <li>The overall score, how many goals were met and the judge&apos;s summary.</li>
        <li>The call recording, the transcript and the scorecard, one row per criterion with evidence.</li>
        <li>The agent&apos;s Langfuse trace, the suggestions, and the handoff brief for a coding agent.</li>
      </Bullets>
      <P>
        Learn to read every part in <GuideLink href="/guide/scoring">Scoring</GuideLink>.
      </P>
    </GuidePage>
  );
}
