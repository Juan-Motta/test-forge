import { FlowDiagram, RunLifecycleDiagram } from "@/features/guide/diagrams";
import { Bullets, Callout, Code, GuideLink, H2, H3, P, Table, Ui } from "@/features/guide/prose";

/** The English body of the "how-it-works" guide page. */
export function HowItWorksEn() {
  return (
    <>
      <P>
        Behind every report there is a simple chain: a scenario becomes runs, each run is a real conversation (a call with a
        voice agent, a chat with a text agent), the conversation leaves a recording or transcript behind, and a judge turns
        it into a report.
      </P>
      <FlowDiagram locale="en" />

      <H2 id="scenario-to-batch">From scenario to batch</H2>
      <P>
        When you press <Ui>Launch</Ui>, Duet creates a <Ui>batch</Ui>: one <Ui>run</Ui> for every scenario you picked, times
        the number of runs each. Launching 2 scenarios with 3 runs each makes a batch of 6 runs. An optional label helps you
        find the batch later, like &ldquo;after prompt fix&rdquo;.
      </P>
      <Bullets>
        <li>
          <Ui>In parallel</Ui> sets how many runs of this batch may call at the same time. The server also has its own limit
          across all batches (3 by default), because each call is a paid session.
        </li>
        <li>
          Each run keeps a <Ui>snapshot</Ui> of everything it was launched with: the scenario, the agent and the evaluator
          setup. Editing a scenario later never changes past runs, so comparisons stay fair.
        </li>
        <li>
          Each run opens its own connection with a fresh <Ui>thread ID</Ui>. It is also the agent&apos;s Langfuse session id,
          which is how Duet finds the agent&apos;s traces for that call.
        </li>
      </Bullets>
      <Callout locale="en" tone="warning" title="A scenario that cannot run stops the launch">
        If a scenario has no voice connection or no evaluator model (a text agent&apos;s scenario always needs an evaluator
        model connection), the launch is refused and the panel lists what is missing. Fix the scenario and launch again.
      </Callout>

      <H2 id="the-call">The call: evaluator and agent</H2>
      <P>
        When a run starts, Duet opens your agent&apos;s WebSocket exactly like a real client and waits until the agent says its
        session is ready. Then the conversation flows turn by turn:
      </P>
      <Bullets>
        <li>The agent speaks (often a greeting first). Duet records its audio and its text.</li>
        <li>
          The evaluator decides what the caller says next, following the persona, the goal, the instructions and the facts. It
          only reveals a fact when the agent asks for it.
        </li>
        <li>The evaluator speaks with a synthetic voice, and the agent answers. Duet times every reply.</li>
        <li>
          The call ends when the caller reaches its goal or says goodbye (depending on the scenario), when the agent closes
          the session, when the time limit is reached, or after too long without speech.
        </li>
      </Bullets>
      <P>
        You can follow all of this from <Ui>Live sessions</Ui>: the transcript appears as people speak, and you can listen
        in. The details of interruptions and evaluator modes are on{" "}
        <GuideLink href="/guide/interruptions-and-evaluator">Interruptions and the evaluator</GuideLink>.
      </P>

      <H2 id="text-agents">Text agents: a chat instead of a call</H2>
      <P>
        With a text agent there is no audio. Duet reaches the agent over Vivi&apos;s channel API, and the evaluator writes
        first:
      </P>
      <Bullets>
        <li>
          The evaluator writes the user&apos;s message, following the same persona, goal, instructions and facts, and Duet
          sends it with an HTTP request: <Code>/stream</Code> (the reply arrives in pieces as it is written) or{" "}
          <Code>/invoke</Code> (the whole reply in one response), depending on the agent&apos;s mode.
        </li>
        <li>
          Every message of the run carries the <Ui>same thread ID</Ui> (a UUID), so the agent sees one conversation. It is
          also the Langfuse session id, as for calls.
        </li>
        <li>
          Duet times each reply from the moment the message is sent: the time to the <Ui>first text</Ui> (the latency in
          Stream mode) and to the <Ui>full reply</Ui> (the latency in Invoke mode), and notes the tools the agent ran.
        </li>
        <li>
          The conversation ends when the evaluator reaches its goal or says goodbye, after the scenario&apos;s{" "}
          <Ui>Max turns</Ui> user messages, at the time limit, or when the evaluator has nothing more to say. If the agent
          fails mid-reply (an HTTP error, or a stream that stops without its end-of-reply event), the run fails and the partial
          reply is kept, marked as broken off.
        </li>
      </Bullets>

      <H2 id="artifacts">What is recorded</H2>
      <Table
        caption="Artifacts saved for every run"
        head={["Artifact", "What it holds"]}
        rows={[
          ["Audio", "Voice agents only: both sides of the call, plus one mixed recording with both voices on the call's timeline, pauses and interruptions included."],
          ["Transcript", "Every turn in order, with when it started and ended. Interrupted agent replies show what was heard and what was not."],
          ["Timings", "Per agent turn: how long it took to start answering (latency), how long it spoke, and how the turn ended. Text agents: when the message was sent, the first text and the full reply arrived, and the tools used."],
          ["Events", "A detailed log of the call (status changes, decisions, interruptions, warnings), used for the live view and the report."],
          ["Summary", "Duration, turn counts, latencies, the protocol your agent spoke (or the text mode), and any warnings."],
        ]}
      />

      <H2 id="run-lifecycle">Run lifecycle</H2>
      <P>Every run moves through the same states. The status chip in the runs table and the live view show where it is.</P>
      <RunLifecycleDiagram locale="en" />
      <H3 id="why-it-ended">Why a run ended</H3>
      <P>Next to the status, the report says why the call ended. The most common reasons:</P>
      <Table
        caption="Common end reasons"
        head={["Reason", "Status", "What it means"]}
        rows={[
          ["Evaluator hung up", "Completed", "The caller reached its goal or said goodbye."],
          ["Agent ended the call", "Completed", "Your agent closed the session."],
          ["Reached the maximum duration", "Completed", "The scenario's time limit was hit."],
          ["Too long without speech", "Completed", "Nobody spoke for the scenario's maximum silence."],
          ["Reached the maximum turns", "Completed", "Text agents: the evaluator sent the scenario's maximum number of messages."],
          ["The evaluator had nothing to say", "Completed", "Text agents: the evaluator ended without a message to send."],
          ["The agent's reply failed", "Failed", "Text agents: an HTTP error, a timeout, or a stream that stopped without its end-of-reply event."],
          ["Could not connect to the agent", "Failed", "The WebSocket URL could not be reached."],
          ["The agent never became ready", "Failed", "The connection opened but the session never started."],
          ["Protocol error", "Failed", "Duet could not recognise or follow the agent's voice protocol."],
          ["Speech synthesis failed / The evaluator model failed", "Failed", "A problem with the caller's voice or brain: check the scenario's connections."],
          ["Cancelled", "Cancelled", "Someone stopped the run."],
          ["The server stopped / restarted", "Interrupted", "Duet itself was stopped during the call."],
        ]}
      />

      <H2 id="judging">Judging</H2>
      <P>
        A run is judged automatically when it ends <Ui>Completed</Ui>, or <Ui>Failed</Ui> after the agent spoke at least once.
        Cancelled and interrupted runs are not judged. The judgement goes through its own short lifecycle:
      </P>
      <Table
        caption="Judgement states"
        head={["State", "What is happening"]}
        rows={[
          ["Queued", "Waiting for the judge."],
          ["Collecting traces", "Only with a Langfuse connection: Duet waits until the agent's traces are complete, checking every 30 seconds, for up to 20 minutes."],
          ["Judging", "The judge model scores every criterion, three times, on the same evidence."],
          ["Completed", "The score, scorecard, suggestions and brief are ready."],
          ["Failed", "The judge could not finish; the report says why and offers Retry."],
        ]}
      />
      <P>
        The judge reads the transcript, the timings and, when available, the agent&apos;s traces (tool calls, models and
        errors). How it scores is explained in <GuideLink href="/guide/scoring">Scoring</GuideLink>.
      </P>

      <H2 id="the-report">The report</H2>
      <P>
        The run page brings everything together: the verdict at the top, the call recording with audio lanes (for a text
        agent, the conversation metrics), and four tabs:{" "}
        <Ui>Transcript &amp; scorecard</Ui>, <Ui>Langfuse trace</Ui>, <Ui>Suggestions</Ui> and <Ui>Handoff</Ui>. From there you
        can also <Ui>Re-run</Ui> the scenario (a new, paid call with the scenario as it is now) or <Ui>Re-judge</Ui> the call.
      </P>
    </>
  );
}
