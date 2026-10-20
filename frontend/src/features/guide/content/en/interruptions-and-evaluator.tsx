import { BargeInIllustration } from "@/features/guide/diagrams";
import { Bullets, Callout, Code, H2, H3, P, Step, Steps, Table, Ui } from "@/features/guide/prose";

/** The English body of the "interruptions-and-evaluator" guide page. */
export function InterruptionsEn() {
  return (
    <>
      <P>
        Real callers do not wait politely for every sentence to finish. This page explains how TestForge&apos;s caller can
        interrupt your agent, the two ways it can speak, and how a call comes to an end.
      </P>

      <H2 id="barge-in">Interruptions (barge-in)</H2>
      <P>
        A <Ui>barge-in</Ui> is when someone starts talking while the other side is still speaking. TestForge can make the caller cut
        your agent off mid-reply, exactly like a person would, to check that the agent stops, listens, and does not pretend the
        caller heard the part that was never played.
      </P>
      <BargeInIllustration locale="en" />

      <H3 id="set-up-interruptions">Setting it up</H3>
      <Steps>
        <Step title="Open the scenario and go to section 6 · Interruptions.">
          By default the caller never interrupts the agent.
        </Step>
        <Step title="Choose Add interruption.">
          Pick which agent reply to cut (replies count from 1; if the agent greets first, the greeting is reply 1) and after how many seconds of it (from
          0.3 to 60).
        </Step>
        <Step title="Add more if you like.">Up to 10 interruptions per scenario, one per agent reply.</Step>
      </Steps>
      <Callout locale="en" tone="warning" title="Only on the Realtime protocol">
        Interruptions work with agents that speak the Realtime protocol. On other protocols the run shows a warning and the
        caller does not interrupt.
      </Callout>

      <H3 id="what-you-see">What you see afterwards</H3>
      <Bullets>
        <li>
          In the transcript, an interrupted reply shows the part the caller heard and the part that was generated but never
          played. The heard part is an <Ui>estimate</Ui>, based on how much of the audio played, so it can be off by a word or
          so around the cut.
        </li>
        <li>
          The caller only reacts to what it heard, like a person would.
        </li>
        <li>
          TestForge records whether your agent&apos;s server <Ui>confirmed</Ui> the cut (it trimmed or deleted the unheard part of
          its reply). The confirmation can arrive a little later in the call.
        </li>
        <li>
          The live view and report also mark the opposite case: the agent starting to talk while the caller is mid-sentence.
        </li>
      </Bullets>
      <Callout locale="en" tone="tip" title="Judging recall after an interruption">
        When you test that the agent remembers only what was heard, accept careful answers too: restarting from a safe point or
        admitting it is unsure are both fine behaviours. A criterion like &ldquo;does not repeat information the caller never
        heard as if it had been said&rdquo; works better than demanding an exact resume point.
      </Callout>

      <H2 id="evaluator-modes">Evaluator modes</H2>
      <P>
        The evaluator is the simulated caller. In section <Ui>7 · Evaluator</Ui> of a scenario you choose how it hears your agent
        and speaks back.
      </P>
      <Table
        caption="The two evaluator modes"
        head={["", "Pipeline (STT → LLM → TTS)", "Speech-to-speech (realtime)"]}
        rows={[
          ["How it works", "A chat model decides what the caller says; a text-to-speech voice says it.", "One speech model hears the agent's audio and answers directly by voice."],
          ["Feels", "Reliable and predictable.", "Faster and more natural."],
          ["Cost", "Lower: text-to-speech is the cheapest way to give the caller a voice.", "Higher: the speech model is billed for the audio it hears and the audio it speaks."],
          ["Needs", "A voice connection, and a chat model (the voice connection, or a separate evaluator model connection).", "An OpenAI connection, or Azure OpenAI with a realtime deployment."],
        ]}
      />
      <P>Pipeline is the default and a good choice for most scenarios.</P>

      <H3 id="realtime-models">Realtime models</H3>
      <Table
        caption="Models for the speech-to-speech evaluator"
        head={["Model", "Trade-off"]}
        rows={[
          [<Code key="mini">gpt-realtime-2.1-mini</Code>, "The default. Cheaper, but in tests it sometimes slipped out of the caller role."],
          [<Code key="full">gpt-realtime-2.1</Code>, "Keeps the caller role reliably; about 3 times the audio cost."],
        ]}
      />
      <P>
        With an Azure OpenAI connection, the realtime model you pick needs its own deployment on that connection, or those
        scenarios fail.
      </P>

      <H3 id="voices">Voices</H3>
      <P>
        The caller uses the voice of its voice connection, unless the scenario sets a <Ui>voice override</Ui>. In
        speech-to-speech mode the voice must be one of: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin or cedar.
        The persona&apos;s locale (like <Code>en-US</Code> or <Code>es-MX</Code>) sets the language the caller speaks.
      </P>

      <H2 id="hang-up">When the call ends</H2>
      <P>
        Section <Ui>5 · When the call ends</Ui> of the scenario sets the limits. Whatever happens, the call stops at the maximum
        duration.
      </P>
      <Table
        caption="Hang-up rules"
        head={["Hang up when", "The caller hangs up…"]}
        rows={[
          ["Goal met or goodbye said", "As soon as it reached its goal, or when someone says goodbye. The default."],
          ["Goodbye said", "Only after a goodbye, even if the goal was reached earlier."],
          ["Max duration reached", "Never on its own: the call runs until the time limit."],
        ]}
      />
      <Bullets>
        <li>
          <Ui>Max duration</Ui>: from 30 seconds to 30 minutes; 6 minutes by default.
        </li>
        <li>
          <Ui>Max silence</Ui>: from 5 to 120 seconds without anyone speaking; 15 by default.
        </li>
        <li>Your agent can also end the call by closing the session.</li>
      </Bullets>
    </>
  );
}
