import type { ReactNode } from "react";
import { Code, Definitions, GuideLink, H2, H3, P, Region, Ui } from "@/features/guide/prose";

function Item({ question, children }: { question: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel px-4 py-3.5">
      <H3>{question}</H3>
      <div className="flex flex-col gap-2 text-[15px] leading-7 text-body">{children}</div>
    </div>
  );
}

const GLOSSARY = [
  { term: "Agent", definition: "The agent under test: a voice agent reached over its WebSocket, or a text agent reached over Vivi's channel API. Shown in blue." },
  { term: "Evaluator", definition: "TestForge's simulated user. It plays a persona and pursues a goal, speaking with a synthetic voice to a voice agent or writing to a text agent. Shown in amber." },
  { term: "Scenario", definition: "One kind of call: the persona, goal, facts, success criteria, end conditions, interruptions and evaluator setup." },
  { term: "Persona", definition: "Who the caller is: a name, a language (locale), a temperament and notes on habits." },
  { term: "Batch", definition: "Everything created by one launch: one run per scenario and repetition." },
  { term: "Run", definition: "One real call between the evaluator and the agent, with its recording, transcript, timings and report." },
  { term: "Criterion", definition: "One thing a good call does, with a weight and an evidence source (transcript, timing or trace)." },
  { term: "Must criterion", definition: "An essential criterion: if it fails, the call counts as failed whatever the score." },
  { term: "Band", definition: "The judge's 1-to-5 rating of a criterion, which fixes its points (25 to 100) and its verdict." },
  { term: "Judgement", definition: "The judge's result for one run: score, verdicts, evidence, suggestions and brief." },
  { term: "Brief", definition: "A Markdown note, ready to paste into a coding agent, that explains what to change in your agent and why." },
  { term: "Barge-in", definition: "Talking over the other side. The caller can be set up to cut the agent off mid-reply." },
  { term: "Latency", definition: "How long the agent takes to start answering after the caller stops speaking. For a text agent: from the user message to the first text (Stream) or the full reply (Invoke)." },
  { term: "Thread ID", definition: "A fresh id for every run, also used as the agent's Langfuse session id. Use it to find the call in your agent's own logs." },
  { term: "Connection", definition: "Stored credentials for a provider (OpenAI, Azure OpenAI, Azure AI Speech or Langfuse). Secrets are never shown again." },
];

/** The English body of the "faq" guide page. */
export function FaqEn() {
  return (
    <>
      <H2 id="troubleshooting">Troubleshooting</H2>
      <div className="flex flex-col gap-3">
        <Item question="I can't sign in.">
          <P>
            Use the address your administrator gave you, and on a local setup open <Code>http://localhost:3000</Code>, not{" "}
            <Code>127.0.0.1</Code>. There is no public sign-up: an administrator creates accounts. After many failed attempts,
            sign-in is paused for a while for your address; wait and try again.
          </P>
        </Item>
        <Item question="The launch says &ldquo;Some scenarios cannot run&rdquo;.">
          <P>
            A scenario is missing what the caller needs: a voice connection, or a chat model for the evaluator (an Azure OpenAI
            connection needs a chat deployment for that). Open the scenario, go to <Ui>7 · Evaluator</Ui>, fix the connections and
            launch again.
          </P>
        </Item>
        <Item question="My run failed with &ldquo;Could not connect to the agent&rdquo;.">
          <P>
            TestForge could not reach the WebSocket URL. Check it on the agent page and press <Ui>Run connection test</Ui>. Use{" "}
            <Code>wss://</Code> for remote agents; <Code>ws://</Code> only works for local addresses such as{" "}
            <Code>localhost</Code>.
          </P>
        </Item>
        <Item question="&ldquo;The agent never became ready&rdquo; or &ldquo;Protocol error&rdquo;.">
          <P>
            The connection opened but the session did not start, or TestForge did not recognise the agent&apos;s protocol. Check the
            Channel ID, User ID and Origin (re-importing a fresh cURL is the easiest way), and try setting <Ui>Protocol</Ui> to
            the one your agent speaks instead of Auto-detect.
          </P>
        </Item>
        <Item question="&ldquo;Speech synthesis failed&rdquo; or &ldquo;The evaluator model failed&rdquo;.">
          <P>
            The caller&apos;s voice or chat model returned an error. Open <Ui>Settings → Connections</Ui> and press{" "}
            <Ui>Test connection</Ui> on the connections the scenario uses. A realtime evaluator on Azure OpenAI also needs a
            realtime deployment for the model you chose.
          </P>
        </Item>
        <Item question="My text agent fails with &ldquo;Access denied (HTTP 403)&rdquo;.">
          <P>
            The agent&apos;s channel refused the message. On an API channel the <Code>vivi-api-key</Code> is missing (a wrong key
            gives HTTP 401 instead): set <Ui>Authentication</Ui> to <Ui>API key</Ui> and save the key. On a WEB channel, such as
            the portal&apos;s testing channel, the Origin is checked: leave <Ui>Origin</Ui> empty or set it to the portal or
            one of the channel&apos;s allowed domains. A 403 also comes when the workspace&apos;s subscription is not active.
          </P>
        </Item>
        <Item question="My text agent fails with &ldquo;The agent refused the message (HTTP 422)&rdquo;.">
          <P>
            API and WEB channels require the <Code>threadId</Code> to be a UUID. TestForge always sends one, so a 422 usually means
            the base URL or channel points to a different service; check them, or re-import a fresh cURL, and press{" "}
            <Ui>Run connection test</Ui>.
          </P>
        </Item>
        <Item question="&ldquo;The agent's stream ended before the reply finished (no on_chat_end event)&rdquo;.">
          <P>
            In Stream mode every reply must end with the <Code>on_chat_end</Code> event. A stream that stops without it is a
            failure: the agent errored mid-reply (a context that grew too long sends a short message and then stops). The run
            fails, and the report keeps the partial reply marked <Ui>Reply broke off</Ui>. Check the agent&apos;s traces for that
            thread ID. An agent with a response schema cannot stream at all (HTTP 409): switch it to <Ui>Invoke</Ui>.
          </P>
        </Item>
        <Item question="The judgement is taking a long time.">
          <P>
            Without Langfuse it usually takes a few minutes. With Langfuse, TestForge waits until the agent&apos;s traces stop
            changing, which can take up to about 20 minutes after the call. The report shows how long it has been waiting.
          </P>
        </Item>
        <Item question="A criterion says &ldquo;Traces unavailable&rdquo;.">
          <P>
            It is a trace criterion, but TestForge found no traces. Link a Langfuse connection to the agent, check that your agent
            uses the run&apos;s thread ID as its Langfuse session id, then <Ui>Re-judge</Ui> the run.
          </P>
        </Item>
        <Item question="The caller never interrupts, even though I set interruptions.">
          <P>
            Interruptions only work with agents on the Realtime protocol; on others the run shows a warning instead. Also check
            that the agent&apos;s reply was longer than the interruption point.
          </P>
        </Item>
        <Item question="The same scenario gets different scores.">
          <P>
            Some variation is normal: every call is a new conversation. Launch 3 or more runs and compare them. If one criterion
            keeps changing or shows <Ui>Judges disagreed</Ui>, rewrite it more concretely. See{" "}
            <GuideLink href="/guide/scoring#writing-criteria">writing good criteria</GuideLink>.
          </P>
        </Item>
        <Item question="I can't delete an agent.">
          <P>An agent can only be deleted when no scenario uses it. Delete or move its scenarios first.</P>
        </Item>
        <Item question="I lost an API key.">
          <P>
            Keys are shown only once and cannot be recovered. Create a new one, update your scripts, and revoke the old key.
          </P>
        </Item>
      </div>

      <H2 id="faq">Frequently asked questions</H2>
      <div className="flex flex-col gap-3">
        <Item question="Does editing a scenario change past results?">
          <P>No. Every run keeps a snapshot of what it was launched with. Re-run the scenario to try the new version.</P>
        </Item>
        <Item question="How much does a run cost?">
          <P>
            Each run uses your agent (a real session), the evaluator&apos;s chat model (and, for calls, its voice or realtime model), and the judge
            (3 model calls per judgement). The cost depends on your providers and the call length; the launch panel shows how
            many calls you are about to make. Each run report shows the evaluation&apos;s approximate cost (evaluator and judge)
            from the prices under <Ui>Settings → Model prices</Ui>.
          </P>
        </Item>
        <Item question="Can I stop a call?">
          <P>
            Yes: <Ui>End call</Ui> (<Ui>End conversation</Ui> for a text agent) in the live view, <Ui>Cancel run</Ui> on a run, or <Ui>Stop all</Ui> for a whole batch.
            Cancelled runs are not judged; finished runs keep their results.
          </P>
        </Item>
        <Item question="Can I download a recording?">
          <P>
            Yes. On the run report, <Ui>Download conversation .wav</Ui> gives you both voices on one timeline. Under{" "}
            <Ui>Separate tracks</Ui> you can also get each side on its own (those two files are not aligned in time).
          </P>
        </Item>
        <Item question="Which languages can the caller speak?">
          <P>
            The language of the persona&apos;s locale, like <Code>en-US</Code> or <Code>es-MX</Code>, as far as the voice and
            chat models support it.
          </P>
        </Item>
        <Item question="Can I use Azure AI Speech for the caller's voice?">
          <P>Not yet. You can store an Azure AI Speech connection, but use OpenAI or Azure OpenAI as the voice for now.</P>
        </Item>
        <Item question="Is there a light theme?">
          <P>
            Yes. Pick <Ui>System, Light or Dark</Ui> in the app under <Ui>Settings → Preferences</Ui>, on the sign-in page or
            in this guide&apos;s header. System follows your device. The choice is remembered in this browser only.
          </P>
        </Item>
        <Item question="Can I use the app in Spanish?">
          <P>
            Yes. Pick <Ui>EN or ES</Ui> in the app under <Ui>Settings → Preferences</Ui>, on the sign-in page or in this
            guide&apos;s header. The app&apos;s screens change language; your data, like scenario names and transcripts, stays
            as written.
          </P>
        </Item>
        <Item question="Can I see a text agent's replies exactly as it sent them?">
          <P>
            Yes. Text agents&apos; replies show formatted as Markdown (bold, lists, links, code). Pick <Ui>Raw</Ui> under{" "}
            <Ui>Settings → Preferences → Agent replies</Ui> to see them as sent, marks included. The choice is remembered in
            this browser only.
          </P>
        </Item>
        <Item question="Who can read this guide?">
          <P>
            Anyone who can reach TestForge: the guide and the API reference need no sign-in. Everything else in the app and the API
            does.
          </P>
        </Item>
      </div>

      <Region id="glossary" title="Glossary">
        <Definitions items={GLOSSARY} />
      </Region>
    </>
  );
}
