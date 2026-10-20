import { SamplesDiagram } from "@/features/guide/diagrams";
import { ScorecardMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, H2, H3, P, Table, Ui } from "@/features/guide/prose";
import { Badge } from "@/ui";

/** The English body of the "scoring" guide page. */
export function ScoringEn() {
  return (
    <>
      <P>
        After each call, a judge model reviews it against the scenario&apos;s success criteria. TestForge keeps the judge on a
        short leash: it picks a band from 1 to 5 for each criterion, and fixed rules turn those bands into points, verdicts and
        an overall score. That keeps scores stable from one judgement to the next.
      </P>

      <H2 id="criteria">Criteria, weights and must criteria</H2>
      <P>Each scenario has between 1 and 30 criteria. Every criterion has:</P>
      <Bullets>
        <li>
          <Ui>Text</Ui>: one thing a good call does, like &ldquo;The agent verifies identity before acting.&rdquo;
        </li>
        <li>
          <Ui>Kind</Ui>: <Ui>Must</Ui> (essential: if it fails, the whole call counts as failed, whatever the score) or{" "}
          <Ui>Should</Ui> (it matters, but only through its weight).
        </li>
        <li>
          <Ui>Evidence source</Ui>: what the judge looks at. <Ui>Transcript</Ui> for what was said, <Ui>Timing</Ui> for how
          fast the agent answered, <Ui>Trace</Ui> for what happened inside the agent (tool calls, models, errors), which needs
          a Langfuse connection on the agent.
        </li>
        <li>
          <Ui>Weight</Ui>: how much it counts. The weights of a scenario must add up to exactly 100.
        </li>
      </Bullets>

      <H2 id="bands">Bands, points and verdicts</H2>
      <P>For every criterion the judge picks a band. The band decides the points and the verdict:</P>
      <Table
        caption="Bands, points and verdicts"
        head={["Band", "Points", "Verdict", "What the judge saw"]}
        rows={[
          ["5", "100", <Badge key="5" tone="success">Pass</Badge>, "Fully met, shown by the evidence, with no defect."],
          ["4", "90", <Badge key="4" tone="success">Pass</Badge>, "Met, with a minor issue that does not change the outcome."],
          ["3", "70", <Badge key="3" tone="evaluator">Partial</Badge>, "Partly met or mixed: an important part is missing or wrong."],
          ["2", "50", <Badge key="2" tone="danger">Fail</Badge>, "Mostly not met, or met but with one serious (capping) defect."],
          ["1", "25", <Badge key="1" tone="danger">Fail</Badge>, "Not met, contradicted, or a clear failure."],
        ]}
      />
      <P>
        A criterion the judge could not check gets <Badge tone="neutral">Not observable</Badge> instead, with no points (see
        below).
      </P>

      <H2 id="overall-score">The overall score</H2>
      <P>
        The overall score, from 0 to 100, is the weighted average of the criteria that could be observed. Criteria that were
        not observable are left out and the others are re-weighted, so a missing trace neither helps nor hurts.
      </P>
      <ScorecardMockup locale="en" />
      <P>
        In the example above: (50 × 50 + 100 × 30 + 70 × 20) ÷ 100 = <strong className="text-fg">69</strong>. And because
        the first criterion is a must criterion that failed, the report also shows <Badge tone="danger">Must criterion failed</Badge>.
        If the second criterion had not been observable, the score would be (50 × 50 + 70 × 20) ÷ 70 ≈{" "}
        <strong className="text-fg">56</strong>.
      </P>
      <Table
        caption="Score colours used across the app"
        head={["Score", "Label", "Colour"]}
        rows={[
          ["80 to 100", "Good", "Green"],
          ["60 to 79", "Fair", "Amber"],
          ["Below 60", "Poor", "Red"],
        ]}
      />

      <H2 id="caps-and-tags">Failure tags and caps</H2>
      <P>
        When a criterion is not perfect, the judge labels what went wrong with up to 5 failure tags from a fixed list. The
        report counts them across the call, so repeated problems stand out.
      </P>
      <Table
        caption="Failure tags"
        head={["Tag", "Caps the criterion at band 2?"]}
        rows={[
          ["Fabricated information", "Yes"],
          ["Wrong information", "Yes"],
          ["Instruction ignored", "Yes"],
          ["Unsafe or policy violation", "Yes"],
          ["Missing information request", "No"],
          ["Incomplete task", "No"],
          ["Off topic", "No"],
          ["Unclear or unnatural speech", "No"],
          ["Cut-off or incomplete reply", "No"],
          ["Slow response", "No"],
          ["Tool or trace error", "No"],
        ]}
      />
      <Callout locale="en" tone="warning" title="Capped criteria are serious">
        The four capping tags limit a criterion to band 2 (a fail), however good the rest of the answer was. The report marks
        it <Badge tone="danger">Capped</Badge> and says why. Treat a capped criterion as a real defect, even when the overall
        score looks fine.
      </Callout>

      <H2 id="not-observable">When a criterion is not observable</H2>
      <Table
        caption="Why a criterion can be not observable"
        head={["Reason", "What to do"]}
        rows={[
          ["Traces unavailable", "A trace criterion, but no traces: link a Langfuse connection to the agent, or wait for the traces and re-judge."],
          ["No timing data", "A timing criterion, but the call had no measured agent turns."],
          ["The judge could not observe it", "The call never got to that point. Check the scenario leads there, or that the call did not end early."],
          ["The judge gave no verdict", "Rare. Re-judge the run."],
        ]}
      />

      <H2 id="samples">Three samples, one median</H2>
      <P>
        Language models can answer differently each time. So the judge looks at every call three times, on exactly the same
        evidence, and each criterion keeps the median band. The scorecard shows the three samples as small dots.
      </P>
      <SamplesDiagram locale="en" />

      <H2 id="timing">Timing and latency</H2>
      <P>
        <Ui>Latency</Ui> is how long the agent takes to start answering: from the moment the caller stops speaking to the
        agent&apos;s first sound. A greeting has no latency. The report shows the median (p50) and the slowest reply.
      </P>
      <P>
        As a rough guide for phone calls, a median under about 1.5 seconds feels responsive and replies over about 3 seconds
        feel broken. But the judge only applies what your timing criteria say, so write the number you expect, like
        &ldquo;Every agent reply starts in under 2 seconds.&rdquo;
      </P>
      <H3 id="timing-text">Timing for text agents</H3>
      <P>
        A text agent has no sound, so its timings start when the user message is sent. The judge sees, for every reply, the
        time to the <Ui>first text</Ui> and to the <Ui>full reply</Ui>, and the tools the agent ran. In <Ui>Stream</Ui> mode
        latency is the time to the first text; in <Ui>Invoke</Ui> mode the whole reply arrives at once, so the first text and
        the full reply are the same. A reply that broke off (the agent failed before finishing it) is marked and never counts
        as a measured reply. Write timing criteria for what the user sees, like &ldquo;Every reply starts within 3
        seconds.&rdquo;
      </P>

      <H2 id="evidence">Evidence</H2>
      <P>Every verdict comes with the evidence the judge relied on: exact quotes, and references to where they come from.</P>
      <Table
        caption="Evidence references"
        head={["Reference", "Points to"]}
        rows={[
          [<Code key="a">A3</Code>, "The agent's 3rd turn in the transcript."],
          [<Code key="c">C2</Code>, "The caller's 2nd turn (for a text agent, the user's 2nd message)."],
          [<Code key="t">T3</Code>, "The timing row of the agent's 3rd turn (for a text agent, its 3rd reply)."],
          [<Code key="r">R1</Code>, "The 1st Langfuse trace of the call."],
        ]}
      />

      <H2 id="reading-results">Reading the results</H2>
      <H3>Looks good</H3>
      <P>No must criterion failed, a score of 90 or more, nothing capped, every criterion observable, and samples that agree.</P>
      <H3>Needs work</H3>
      <P>
        A must criterion failed, a capped criterion, a score under about 70, or the same tag (like slow response or incomplete
        task) coming back across runs.
      </P>
      <H3>Inconclusive</H3>
      <P>
        Many criteria not observable, or a call that ended early (failed, or too long without speech). Fix the setup before
        drawing conclusions about the agent.
      </P>
      <Callout locale="en" tone="tip" title="Compare several runs">
        One run is a sample of one. Launch 3 or more runs of the same scenario and compare their scores before deciding that a
        change helped.
      </Callout>

      <H2 id="suggestions-and-brief">Suggestions and the brief</H2>
      <P>
        The judge also writes <Ui>suggestions</Ui>: concrete changes, each with an area (prompt, tools, flow, latency, voice or
        other), a priority (high, medium or low) and its evidence. The <Ui>Handoff</Ui> tab turns everything into a{" "}
        <Ui>brief</Ui>: a Markdown note meant to be pasted, on its own, into a coding agent. It covers the problems found, what
        could not be checked, the changes to make (most important first), what worked, and how to verify the fix.
      </P>

      <H2 id="writing-criteria">Writing good criteria</H2>
      <Bullets>
        <li>
          Make each one checkable from the call: &ldquo;Confirms the card is blocked&rdquo;, not &ldquo;Is helpful&rdquo;.
        </li>
        <li>One idea per criterion. Split &ldquo;verifies identity and blocks the card&rdquo; into two.</li>
        <li>Put the numbers in timing criteria (&ldquo;under 2 seconds&rdquo;).</li>
        <li>Keep must criteria for what truly makes or breaks the call.</li>
        <li>
          If the samples often disagree on a criterion (the report says <Badge tone="evaluator">Judges disagreed</Badge>), its
          wording is probably ambiguous: make it more concrete.
        </li>
        <li>Keep a criterion when you edit it, rather than deleting and re-adding it, so results stay comparable over time.</li>
      </Bullets>
    </>
  );
}
