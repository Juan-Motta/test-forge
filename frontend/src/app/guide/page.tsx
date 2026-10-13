import { FlowDiagram } from "@/features/guide/diagrams";
import { GuidePage } from "@/features/guide/GuidePage";
import { Bullets, Callout, GuideLink, H2, Lead, P, Ui } from "@/features/guide/prose";
import { guideMetadata } from "@/features/guide/sections";
import { Badge } from "@/ui";

export const metadata = guideMetadata("overview");

export default function GuideOverviewPage() {
  return (
    <GuidePage slug="overview">
      <Lead>
        Duet tests voice agents the way your customers meet them: on a call. A simulated caller, the{" "}
        <strong className="text-evaluator-fg">evaluator</strong>, phones your{" "}
        <strong className="text-agent-fg">agent under test</strong>, plays a person with a goal, and every call is recorded
        and then scored by a judge.
      </Lead>

      <H2 id="what-is-duet">What is Duet?</H2>
      <P>
        Building a voice agent is the easy part. Knowing whether it still works after you change a prompt, a tool or a model
        is hard: you would have to call it yourself, again and again, and listen carefully every time. Duet does those calls
        for you.
      </P>
      <P>
        You write down the kinds of calls you care about (a customer who lost a card, someone in a hurry, a caller who keeps
        interrupting). Duet places those calls for real, against your agent&apos;s own voice connection, and gives you back
        the recording, the transcript, timings and a report that says what went well, what went wrong and what to change.
      </P>

      <H2 id="who-is-it-for">Who is it for?</H2>
      <Bullets>
        <li>
          <strong className="text-fg">Teams building voice agents</strong> who want to catch regressions before their users
          do.
        </li>
        <li>
          <strong className="text-fg">Product and QA people</strong> who want to listen to calls and read clear reports
          without touching code.
        </li>
        <li>
          <strong className="text-fg">Developers and AI coding agents</strong> who want a ready-made brief of what to fix, or
          who drive Duet from scripts and CI through its API.
        </li>
      </Bullets>

      <H2 id="the-idea">The idea: the evaluator is the caller</H2>
      <P>
        Most test tools send text to a model. Duet instead acts like a phone caller. The evaluator connects to your agent over
        the same WebSocket voice protocol a real client uses, speaks with a real synthetic voice, listens to the answers and
        decides what to say next, following a persona and a goal. It can even cut the agent off mid-sentence, like people
        do.
      </P>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Throughout the app,</span>
        <Badge tone="agent">blue is your agent</Badge>
        <span>and</span>
        <Badge tone="evaluator">amber is the evaluator</Badge>
      </div>

      <H2 id="the-big-picture">The big picture</H2>
      <P>Every evaluation follows the same path, from a written scenario to a report you can act on.</P>
      <FlowDiagram />
      <P>
        The page <GuideLink href="/guide/how-it-works">How it works</GuideLink> walks through each step in detail.
      </P>

      <H2 id="what-you-get">What you get from each call</H2>
      <Bullets>
        <li>
          <Ui>A recording</Ui> of the whole conversation, both voices on one timeline, with pauses and interruptions as they
          happened.
        </li>
        <li>
          <Ui>A transcript</Ui> with timings: how long the agent took to start answering each time.
        </li>
        <li>
          <Ui>A score from 0 to 100</Ui> and a verdict for each of your success criteria, with quotes as evidence.
        </li>
        <li>
          <Ui>Suggestions</Ui> ranked by priority, and a <Ui>brief</Ui>: a ready-to-paste note for a coding agent that
          explains what to change.
        </li>
      </Bullets>

      <Callout tone="note" title="Calls cost money">
        Each run is a real call: it opens a session with your agent and uses paid speech and language models for the caller
        and the judge. Start with one or two runs and grow from there.
      </Callout>

      <H2 id="where-next">Where to go next</H2>
      <P>
        New to Duet? Follow <GuideLink href="/guide/getting-started">Getting started</GuideLink> for your first call. Looking
        for a specific screen? See <GuideLink href="/guide/modules">The modules</GuideLink>. Puzzled by a score? Read{" "}
        <GuideLink href="/guide/scoring">Scoring</GuideLink>.
      </P>
    </GuidePage>
  );
}
