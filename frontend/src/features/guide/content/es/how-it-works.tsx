import { FlowDiagram, RunLifecycleDiagram } from "@/features/guide/diagrams";
import { Bullets, Callout, Code, GuideLink, H2, H3, P, Table, Ui } from "@/features/guide/prose";

/** The Spanish body of the "how-it-works" guide page. */
export function HowItWorksEs() {
  return (
    <>
      <P>
        Detrás de cada reporte hay una cadena sencilla: un escenario se convierte en corridas, cada corrida es una conversación
        real (una llamada con un agente de voz, un chat con un agente de texto), la conversación deja una grabación o una
        transcripción, y un juez la convierte en un reporte.
      </P>
      <FlowDiagram locale="es" />

      <H2 id="scenario-to-batch">Del escenario al lote</H2>
      <P>
        Cuando presionas <Ui>Lanzar</Ui>, TestForge crea un <Ui>lote</Ui>: una <Ui>corrida</Ui> por cada escenario que elegiste,
        multiplicada por la cantidad de corridas por escenario. Lanzar 2 escenarios con 3 corridas cada uno crea un lote de 6
        corridas. Una etiqueta opcional te ayuda a encontrar el lote después, como «después del ajuste del prompt».
      </P>
      <Bullets>
        <li>
          <Ui>En paralelo</Ui> define cuántas corridas de este lote pueden llamar al mismo tiempo. El servidor también tiene su
          propio límite para todos los lotes (3 de forma predeterminada), porque cada llamada es una sesión de pago.
        </li>
        <li>
          Cada corrida guarda una <Ui>instantánea</Ui> de todo aquello con lo que se lanzó: el escenario, el agente y la
          configuración del evaluador. Editar un escenario después nunca cambia las corridas anteriores, así que las
          comparaciones siguen siendo justas.
        </li>
        <li>
          Cada corrida abre su propia conexión con un <Ui>ID del hilo</Ui> nuevo. También es el ID de sesión de Langfuse del
          agente, que es como TestForge encuentra las trazas del agente para esa llamada.
        </li>
      </Bullets>
      <Callout locale="es" tone="warning" title="Un escenario que no se puede ejecutar detiene el lanzamiento">
        Si un escenario no tiene conexión de voz o no tiene modelo del evaluador (el escenario de un agente de texto siempre
        necesita una conexión del modelo del evaluador), el lanzamiento se rechaza y el panel lista lo que falta. Corrige el
        escenario y vuelve a lanzar.
      </Callout>

      <H2 id="the-call">La llamada: evaluador y agente</H2>
      <P>
        Cuando empieza una corrida, TestForge abre el WebSocket de tu agente exactamente como un cliente real y espera a que el
        agente diga que su sesión está lista. Luego la conversación avanza turno por turno:
      </P>
      <Bullets>
        <li>El agente habla (a menudo primero saluda). TestForge graba su audio y su texto.</li>
        <li>
          El evaluador decide qué dice después quien llama, siguiendo la persona, el objetivo, las instrucciones y los datos.
          Solo revela un dato cuando el agente se lo pide.
        </li>
        <li>El evaluador habla con una voz sintética y el agente responde. TestForge mide el tiempo de cada respuesta.</li>
        <li>
          La llamada termina cuando quien llama cumple su objetivo o se despide (según el escenario), cuando el agente cierra la
          sesión, cuando se alcanza el límite de tiempo o después de demasiado tiempo sin habla.
        </li>
      </Bullets>
      <P>
        Puedes seguir todo esto desde <Ui>Sesiones en vivo</Ui>: la transcripción aparece a medida que se habla y puedes
        escuchar la llamada. Los detalles de las interrupciones y de los modos del evaluador están en{" "}
        <GuideLink href="/guide/interruptions-and-evaluator">Interrupciones y el evaluador</GuideLink>.
      </P>

      <H2 id="text-agents">Agentes de texto: un chat en lugar de una llamada</H2>
      <P>
        Con un agente de texto no hay audio. TestForge llega al agente por la API de canales de Vivi, y el evaluador escribe
        primero:
      </P>
      <Bullets>
        <li>
          El evaluador escribe el mensaje del usuario, siguiendo la misma persona, el objetivo, las instrucciones y los datos, y
          TestForge lo envía con una solicitud HTTP: <Code>/stream</Code> (la respuesta llega por partes a medida que se escribe) o{" "}
          <Code>/invoke</Code> (toda la respuesta de una vez), según el modo del agente.
        </li>
        <li>
          Cada mensaje de la corrida lleva el <Ui>mismo ID del hilo</Ui> (un UUID), así que el agente ve una sola conversación.
          También es el ID de sesión de Langfuse, igual que en las llamadas.
        </li>
        <li>
          TestForge mide cada respuesta desde el momento en que se envía el mensaje: el tiempo hasta el <Ui>primer texto</Ui> (la
          latencia en modo Stream) y hasta la <Ui>respuesta completa</Ui> (la latencia en modo Invoke), y anota las
          herramientas que ejecutó el agente.
        </li>
        <li>
          La conversación termina cuando el evaluador cumple su objetivo o se despide, después del <Ui>Máximo de turnos</Ui>{" "}
          de mensajes del usuario del escenario, al llegar al límite de tiempo o cuando el evaluador no tiene nada más que
          decir. Si el agente falla a mitad de una respuesta (un error HTTP, o un stream que se detiene sin su evento de fin de
          respuesta), la corrida falla y se conserva la respuesta parcial, marcada como cortada.
        </li>
      </Bullets>

      <H2 id="artifacts">Qué se graba</H2>
      <Table
        caption="Artefactos que se guardan en cada corrida"
        head={["Artefacto", "Qué contiene"]}
        rows={[
          ["Audio", "Solo agentes de voz: los dos lados de la llamada, más una grabación mezclada con las dos voces en la línea de tiempo de la llamada, con pausas e interrupciones incluidas."],
          ["Transcripción", "Cada turno en orden, con cuándo empezó y cuándo terminó. Las respuestas interrumpidas del agente muestran qué se escuchó y qué no."],
          ["Tiempos", "Por turno del agente: cuánto tardó en empezar a responder (latencia), cuánto habló y cómo terminó el turno. Agentes de texto: cuándo se envió el mensaje, cuándo llegaron el primer texto y la respuesta completa, y las herramientas usadas."],
          ["Eventos", "Un registro detallado de la llamada (cambios de estado, decisiones, interrupciones, advertencias), que usan la vista en vivo y el reporte."],
          ["Resumen", "Duración, cantidad de turnos, latencias, el protocolo que habló tu agente (o el modo de texto) y cualquier advertencia."],
        ]}
      />

      <H2 id="run-lifecycle">Ciclo de vida de una corrida</H2>
      <P>Cada corrida pasa por los mismos estados. La etiqueta de estado en la tabla de corridas y la vista en vivo muestran en cuál está.</P>
      <RunLifecycleDiagram locale="es" />
      <H3 id="why-it-ended">Por qué terminó una corrida</H3>
      <P>Junto al estado, el reporte dice por qué terminó la llamada. Los motivos más frecuentes:</P>
      <Table
        caption="Motivos de fin frecuentes"
        head={["Motivo", "Estado", "Qué significa"]}
        rows={[
          ["El evaluador colgó", "Completada", "Quien llama cumplió su objetivo o se despidió."],
          ["El agente terminó la llamada", "Completada", "Tu agente cerró la sesión."],
          ["Llegó a la duración máxima", "Completada", "Se alcanzó el límite de tiempo del escenario."],
          ["Demasiado tiempo sin habla", "Completada", "Nadie habló durante el silencio máximo del escenario."],
          ["Llegó al máximo de turnos", "Completada", "Agentes de texto: el evaluador envió la cantidad máxima de mensajes del escenario."],
          ["El evaluador no tenía nada que decir", "Completada", "Agentes de texto: el evaluador terminó sin un mensaje que enviar."],
          ["Falló la respuesta del agente", "Fallida", "Agentes de texto: un error HTTP, un tiempo de espera agotado o un stream que se detuvo sin su evento de fin de respuesta."],
          ["No se pudo conectar con el agente", "Fallida", "No se pudo llegar a la URL del WebSocket."],
          ["El agente nunca estuvo listo", "Fallida", "La conexión se abrió, pero la sesión nunca empezó."],
          ["Error de protocolo", "Fallida", "TestForge no pudo reconocer o seguir el protocolo de voz del agente."],
          ["Falló la síntesis de voz / Falló el modelo del evaluador", "Fallida", "Un problema con la voz o el cerebro de quien llama: revisa las conexiones del escenario."],
          ["Cancelada", "Cancelada", "Alguien detuvo la corrida."],
          ["El servidor se detuvo / se reinició", "Interrumpida", "TestForge se detuvo durante la llamada."],
        ]}
      />

      <H2 id="judging">La evaluación</H2>
      <P>
        Una corrida se evalúa automáticamente cuando termina <Ui>Completada</Ui>, o <Ui>Fallida</Ui> después de que el agente
        habló al menos una vez. Las corridas canceladas e interrumpidas no se evalúan. La evaluación del juez pasa por su
        propio ciclo de vida corto:
      </P>
      <Table
        caption="Estados de la evaluación del juez"
        head={["Estado", "Qué está pasando"]}
        rows={[
          ["En cola", "Esperando al juez."],
          ["Recopilando trazas", "Solo con una conexión de Langfuse: TestForge espera a que las trazas del agente estén completas, revisando cada 30 segundos, hasta 20 minutos."],
          ["Evaluando", "El modelo juez califica cada criterio, tres veces, sobre la misma evidencia."],
          ["Completada", "La puntuación, la tabla de criterios, las sugerencias y el informe están listos."],
          ["Fallida", "El juez no pudo terminar; el reporte dice por qué y ofrece Reintentar."],
        ]}
      />
      <P>
        El juez lee la transcripción, los tiempos y, cuando están disponibles, las trazas del agente (llamadas a herramientas,
        modelos y errores). Cómo califica se explica en <GuideLink href="/guide/scoring">Puntuación</GuideLink>.
      </P>

      <H2 id="the-report">El reporte</H2>
      <P>
        La página de la corrida reúne todo: el veredicto arriba, la grabación de la llamada con pistas de audio (en un agente
        de texto, las métricas de la conversación) y cuatro pestañas: <Ui>Transcripción y criterios</Ui>,{" "}
        <Ui>Traza de Langfuse</Ui>, <Ui>Sugerencias</Ui> y <Ui>Traspaso</Ui>. Desde ahí también puedes{" "}
        <Ui>Volver a ejecutar</Ui> el escenario (una llamada nueva y de pago con el escenario tal como está ahora) o{" "}
        <Ui>Volver a evaluar</Ui> la llamada.
      </P>
    </>
  );
}
