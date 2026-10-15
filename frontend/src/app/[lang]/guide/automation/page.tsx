import { GuidePage } from "@/features/guide/GuidePage";
import { Bullets, Callout, Code, GuideLink, H2, H3, P, Step, Steps, Table, Ui } from "@/features/guide/prose";
import { guideMetadata } from "@/features/guide/sections";
import { CodeBlock } from "@/ui";

export const metadata = guideMetadata("automation");

const AUTH_HEADER = "Authorization: Bearer ve_xxxxxxxx_<secret>";

const LAUNCH = `# Keep the key in an environment variable; never paste it into files or logs.
curl -s -X POST "$DUET_URL/api/runs" \\
  -H "Authorization: Bearer $DUET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"scenarioIds": ["<scenario id>"], "repetitions": 3, "concurrency": 1, "label": "nightly"}'`;

const FOLLOW = `# The batch: its status and every run's status, judgement status and score
curl -s "$DUET_URL/api/runs/batches/<batch id>" -H "Authorization: Bearer $DUET_API_KEY"

# One run's judgement: score, verdicts, suggestions and the brief
curl -s "$DUET_URL/api/runs/<run id>/judgement" -H "Authorization: Bearer $DUET_API_KEY"`;

const SKILL = `curl -s "$DUET_URL/api/skill" -o SKILL.md          # the guide as one Markdown file
curl -s "$DUET_URL/api/skill.zip" -o voice-evaluator.zip   # a skill folder with the full API reference`;

export default function AutomationPage() {
  return (
    <GuidePage slug="automation">
      <P>
        Everything you do in the app can also be done through Duet&apos;s HTTP API: launching runs from CI after every deploy,
        collecting scores in a script, or letting an AI coding agent run a scenario, read the brief and fix your agent. Three
        things make that possible.
      </P>
      <Table
        caption="The three automation tools"
        head={["Tool", "What it is", "Where"]}
        rows={[
          ["API keys", "Let a script or agent act as you, without signing in.", "Settings → API keys"],
          ["Swagger reference", "Every endpoint with its fields and responses.", <Code key="docs">/api/docs</Code>],
          ["Agent skill", "A guide written for AI agents: concepts, flows and how to read results.", <Code key="skill">/api/skill</Code>],
        ]}
      />

      <H2 id="api-keys">1. Create an API key</H2>
      <Steps>
        <Step title="Open Settings → API keys and choose Create API key.">
          Name it after where it will be used (&ldquo;Nightly CI&rdquo;) and pick when it expires.
        </Step>
        <Step title="Copy the key right away.">
          It is shown only once. Store it as a secret in your CI or in an environment variable.
        </Step>
        <Step title="Send it with every request.">
          <CodeBlock code={AUTH_HEADER} label="Authorization header with an API key" />
        </Step>
      </Steps>
      <Callout tone="warning" title="Treat keys like passwords">
        A key acts as you. Never commit it or print it in logs. If one leaks, <Ui>Revoke</Ui> it: requests with it are refused
        immediately.
      </Callout>

      <H2 id="swagger">2. Explore the API in Swagger</H2>
      <P>
        Open <a href="/api/docs" target="_blank" rel="noopener noreferrer">the API reference (Swagger)</a> from the top of this
        guide or from <Ui>API docs</Ui> in the app&apos;s sidebar. It is public, always matches the running version, and lists
        every endpoint. The raw schema is at <Code>/api/openapi.json</Code>, handy for generating a client.
      </P>
      <P>A few conventions that hold everywhere:</P>
      <Bullets>
        <li>Field names are camelCase, ids are UUIDs and times are in UTC.</li>
        <li>Lists of runs and batches are paged and newest first.</li>
        <li>
          Errors are plain: <Code>401</Code> for a missing or wrong key, <Code>404</Code> for an unknown id,{" "}
          <Code>409</Code> for a conflict (like a name already in use) and <Code>422</Code> for invalid input, pointing at the
          field.
        </li>
      </Bullets>

      <H2 id="typical-flow">3. A typical flow</H2>
      <P>Launch a batch, wait for it, then read the results:</P>
      <CodeBlock code={LAUNCH} label="Launch a batch with curl" tone="command" />
      <P>
        The answer is the new batch with its queued runs. Check it every 10 to 15 seconds until its status is completed or
        cancelled, then read each run&apos;s judgement (allow a few minutes more, up to about 20 with Langfuse):
      </P>
      <CodeBlock code={FOLLOW} label="Follow a batch and read a judgement with curl" tone="command" />
      <P>
        The judgement holds the overall score, whether a must criterion failed, every criterion&apos;s verdict and the{" "}
        <Ui>brief</Ui>. What each field means is in <GuideLink href="/guide/scoring">Scoring</GuideLink>. To follow a run turn
        by turn instead of polling, the API also offers a live WebSocket stream; the Swagger reference and the agent skill
        describe it.
      </P>
      <Callout tone="note" title="Paid actions">
        Launching, re-running and re-judging all call paid providers. A batch costs roughly scenarios × repetitions calls, and
        each judgement makes 3 judge model calls. Reading runs, transcripts and reports is free.
      </Callout>

      <H2 id="agent-skill">4. Give an AI agent the skill</H2>
      <P>
        The <Ui>agent skill</Ui> teaches an AI coding agent (such as Claude Code) how to use Duet: what scenarios, runs and
        judgements are, the flows above with exact requests, and how to read results. It always matches the running version,
        and anyone can fetch it without a key.
      </P>
      <H3>Get it</H3>
      <Bullets>
        <li>
          In the app: <Ui>Settings → API keys</Ui>, the <Ui>Agent skill</Ui> card. Copy the URLs, copy a ready-made command to
          save it, or <Ui>Download skill (.zip)</Ui>.
        </li>
        <li>From a terminal:</li>
      </Bullets>
      <CodeBlock code={SKILL} label="Download the agent skill with curl" tone="command" />
      <P>
        Unzip the folder into your agent&apos;s skills directory and give the agent an API key through an environment
        variable. The skill tells the agent to ask you before anything that costs money, like launching runs.
      </P>

      <H2 id="judge-stability">Measuring judge stability</H2>
      <P>
        For the curious: whoever runs the server can judge one finished run several times, without saving anything, to see how
        much each criterion&apos;s band moves. Each repetition costs 3 judge model calls.
      </P>
      <CodeBlock
        code="docker compose exec backend voice-eval judge-stability <run id> --times 3"
        label="Judge stability command"
        tone="command"
      />
    </GuidePage>
  );
}
