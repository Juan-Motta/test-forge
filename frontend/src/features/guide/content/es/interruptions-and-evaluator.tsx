import { BargeInIllustration } from "@/features/guide/diagrams";
import { Bullets, Callout, Code, H2, H3, P, Step, Steps, Table, Ui } from "@/features/guide/prose";

/** The Spanish body of the "interruptions-and-evaluator" guide page. */
export function InterruptionsEs() {
  return (
    <>
      <P>
        Las personas reales no esperan con paciencia a que termine cada frase. Esta página explica cómo quien llama en Duet
        puede interrumpir a tu agente, las dos formas en que puede hablar y cómo termina una llamada.
      </P>

      <H2 id="barge-in">Interrupciones (barge-in)</H2>
      <P>
        Una <Ui>interrupción</Ui> (en inglés, <em>barge-in</em>) ocurre cuando alguien empieza a hablar mientras el otro lado
        todavía está hablando. Duet puede hacer que quien llama corte a tu agente a mitad de respuesta, exactamente como lo
        haría una persona, para comprobar que el agente se detiene, escucha y no da por hecho que quien llama oyó la parte que
        nunca se reprodujo.
      </P>
      <BargeInIllustration locale="es" />

      <H3 id="set-up-interruptions">Cómo configurarlo</H3>
      <Steps>
        <Step title="Abre el escenario y ve a la sección 6 · Interrupciones.">
          De forma predeterminada, quien llama nunca interrumpe al agente.
        </Step>
        <Step title="Elige Agregar interrupción.">
          Elige qué respuesta del agente cortar (las respuestas se cuentan desde 1; si el agente saluda primero, el saludo es la
          respuesta 1) y después de cuántos segundos de ella (de 0.3 a 60).
        </Step>
        <Step title="Agrega más si quieres.">Hasta 10 interrupciones por escenario, una por respuesta del agente.</Step>
      </Steps>
      <Callout locale="es" tone="warning" title="Solo con el protocolo Realtime">
        Las interrupciones funcionan con agentes que hablan el protocolo Realtime. Con otros protocolos, la corrida muestra una
        advertencia y quien llama no interrumpe.
      </Callout>

      <H3 id="what-you-see">Qué ves después</H3>
      <Bullets>
        <li>
          En la transcripción, una respuesta interrumpida muestra la parte que escuchó quien llama y la parte que se generó pero
          nunca se reprodujo. La parte escuchada es una <Ui>estimación</Ui>, basada en cuánto del audio se reprodujo, así que
          puede variar en una palabra o así alrededor del corte.
        </li>
        <li>Quien llama solo reacciona a lo que escuchó, como lo haría una persona.</li>
        <li>
          Duet registra si el servidor de tu agente <Ui>confirmó</Ui> el corte (recortó o eliminó la parte no escuchada de su
          respuesta). La confirmación puede llegar un poco más tarde en la llamada.
        </li>
        <li>
          La vista en vivo y el reporte también marcan el caso contrario: el agente que empieza a hablar mientras quien llama
          está a mitad de una frase.
        </li>
      </Bullets>
      <Callout locale="es" tone="tip" title="Evaluar lo que recuerda el agente después de una interrupción">
        Cuando pruebes que el agente recuerda solo lo que se escuchó, acepta también respuestas prudentes: retomar desde un
        punto seguro o admitir que no está seguro son comportamientos válidos. Un criterio como «no repite información que quien
        llama nunca escuchó como si ya se hubiera dicho» funciona mejor que exigir un punto exacto para retomar.
      </Callout>

      <H2 id="evaluator-modes">Modos del evaluador</H2>
      <P>
        El evaluador es quien llama, simulado. En la sección <Ui>7 · Evaluador</Ui> de un escenario eliges cómo escucha a tu
        agente y cómo le responde.
      </P>
      <Table
        caption="Los dos modos del evaluador"
        head={["", "Por etapas (STT → LLM → TTS)", "Voz a voz (tiempo real)"]}
        rows={[
          ["Cómo funciona", "Un modelo de chat decide qué dice quien llama; una voz de texto a voz lo dice.", "Un solo modelo de voz escucha el audio del agente y responde directamente con la voz."],
          ["Cómo se siente", "Confiable y predecible.", "Más rápido y más natural."],
          ["Costo", "Menor: el texto a voz es la forma más barata de darle voz a quien llama.", "Mayor: el modelo de voz se cobra por el audio que escucha y por el audio que habla."],
          ["Necesita", "Una conexión de voz y un modelo de chat (la conexión de voz o una conexión del modelo del evaluador aparte).", "Una conexión de OpenAI, o de Azure OpenAI con un deployment de tiempo real."],
        ]}
      />
      <P>Por etapas es el modo predeterminado y una buena opción para la mayoría de los escenarios.</P>

      <H3 id="realtime-models">Modelos de tiempo real</H3>
      <Table
        caption="Modelos para el evaluador de voz a voz"
        head={["Modelo", "Ventajas y desventajas"]}
        rows={[
          [<Code key="mini">gpt-realtime-2.1-mini</Code>, "El predeterminado. Más barato, pero en pruebas a veces se salió del papel de quien llama."],
          [<Code key="full">gpt-realtime-2.1</Code>, "Mantiene el papel de quien llama de forma confiable; cuesta unas 3 veces más en audio."],
        ]}
      />
      <P>
        Con una conexión de Azure OpenAI, el modelo de tiempo real que elijas necesita su propio deployment en esa conexión;
        si no, esos escenarios fallan.
      </P>

      <H3 id="voices">Voces</H3>
      <P>
        Quien llama usa la voz de su conexión de voz, a menos que el escenario defina una <Ui>voz personalizada</Ui>. En el
        modo voz a voz, la voz debe ser una de: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin o cedar. El idioma
        y la región de la persona (como <Code>en-US</Code> o <Code>es-MX</Code>) definen el idioma que habla quien llama.
      </P>

      <H2 id="hang-up">Cuándo termina la llamada</H2>
      <P>
        La sección <Ui>5 · Cuándo termina la llamada</Ui> del escenario define los límites. Pase lo que pase, la llamada se
        detiene al llegar a la duración máxima.
      </P>
      <Table
        caption="Reglas para colgar"
        head={["Colgar cuando", "Quien llama cuelga…"]}
        rows={[
          ["Objetivo cumplido o despedida", "En cuanto cumple su objetivo, o cuando alguien se despide. Es la opción predeterminada."],
          ["Despedida", "Solo después de una despedida, aunque el objetivo se haya cumplido antes."],
          ["Duración máxima alcanzada", "Nunca por su cuenta: la llamada sigue hasta el límite de tiempo."],
        ]}
      />
      <Bullets>
        <li>
          <Ui>Duración máxima</Ui>: de 30 segundos a 30 minutos; 6 minutos de forma predeterminada.
        </li>
        <li>
          <Ui>Silencio máximo</Ui>: de 5 a 120 segundos sin que nadie hable; 15 de forma predeterminada.
        </li>
        <li>Tu agente también puede terminar la llamada cerrando la sesión.</li>
      </Bullets>
    </>
  );
}
