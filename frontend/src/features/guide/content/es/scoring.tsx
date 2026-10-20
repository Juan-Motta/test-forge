import { SamplesDiagram } from "@/features/guide/diagrams";
import { ScorecardMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, H2, H3, P, Table, Ui } from "@/features/guide/prose";
import { Badge } from "@/ui";

/** The Spanish body of the "scoring" guide page. */
export function ScoringEs() {
  return (
    <>
      <P>
        Después de cada llamada, un modelo juez la revisa contra los criterios de éxito del escenario. TestForge mantiene al juez
        con poco margen: elige una banda del 1 al 5 para cada criterio, y reglas fijas convierten esas bandas en puntos,
        veredictos y una puntuación general. Así las puntuaciones se mantienen estables de una evaluación a la siguiente.
      </P>

      <H2 id="criteria">Criterios, pesos y criterios obligatorios</H2>
      <P>Cada escenario tiene entre 1 y 30 criterios. Cada criterio tiene:</P>
      <Bullets>
        <li>
          <Ui>Texto</Ui>: algo que hace una buena llamada, como «El agente verifica la identidad antes de actuar».
        </li>
        <li>
          <Ui>Tipo</Ui>: <Ui>Obligatorio</Ui> (esencial: si no se cumple, toda la llamada cuenta como fallida, sea cual sea la
          puntuación) o <Ui>Deseable</Ui> (importa, pero solo a través de su peso).
        </li>
        <li>
          <Ui>Fuente de evidencia</Ui>: lo que mira el juez. <Ui>Transcripción</Ui> para lo que se dijo, <Ui>Tiempos</Ui> para
          qué tan rápido respondió el agente, <Ui>Traza</Ui> para lo que pasó dentro del agente (llamadas a herramientas,
          modelos, errores), que necesita una conexión de Langfuse en el agente.
        </li>
        <li>
          <Ui>Peso</Ui>: cuánto cuenta. Los pesos de un escenario deben sumar exactamente 100.
        </li>
      </Bullets>

      <H2 id="bands">Bandas, puntos y veredictos</H2>
      <P>Para cada criterio, el juez elige una banda. La banda decide los puntos y el veredicto:</P>
      <Table
        caption="Bandas, puntos y veredictos"
        head={["Banda", "Puntos", "Veredicto", "Lo que vio el juez"]}
        rows={[
          ["5", "100", <Badge key="5" tone="success">Cumple</Badge>, "Se cumplió por completo, lo muestra la evidencia, sin ningún defecto."],
          ["4", "90", <Badge key="4" tone="success">Cumple</Badge>, "Se cumplió, con un problema menor que no cambia el resultado."],
          ["3", "70", <Badge key="3" tone="evaluator">Parcial</Badge>, "Se cumplió en parte o de forma mixta: falta o está mal una parte importante."],
          ["2", "50", <Badge key="2" tone="danger">No cumple</Badge>, "En su mayoría no se cumplió, o se cumplió pero con un defecto grave (que limita)."],
          ["1", "25", <Badge key="1" tone="danger">No cumple</Badge>, "No se cumplió, se contradijo o es un fallo claro."],
        ]}
      />
      <P>
        Un criterio que el juez no pudo comprobar recibe en cambio <Badge tone="neutral">No observable</Badge>, sin puntos (ver
        más abajo).
      </P>

      <H2 id="overall-score">La puntuación general</H2>
      <P>
        La puntuación general, de 0 a 100, es el promedio ponderado de los criterios que se pudieron observar. Los criterios no
        observables se dejan fuera y los demás se vuelven a ponderar, así que una traza que falta ni ayuda ni perjudica.
      </P>
      <ScorecardMockup locale="es" />
      <P>
        En el ejemplo de arriba: (50 × 50 + 100 × 30 + 70 × 20) ÷ 100 = <strong className="text-fg">69</strong>. Y como el
        primer criterio es obligatorio y no se cumplió, el reporte también muestra{" "}
        <Badge tone="danger">Falló un criterio obligatorio</Badge>. Si el segundo criterio no hubiera sido observable, la
        puntuación sería (50 × 50 + 70 × 20) ÷ 70 ≈ <strong className="text-fg">56</strong>.
      </P>
      <Table
        caption="Colores de puntuación usados en toda la app"
        head={["Puntuación", "Etiqueta", "Color"]}
        rows={[
          ["80 a 100", "Bueno", "Verde"],
          ["60 a 79", "Regular", "Ámbar"],
          ["Menos de 60", "Deficiente", "Rojo"],
        ]}
      />

      <H2 id="caps-and-tags">Etiquetas de fallo y límites</H2>
      <P>
        Cuando un criterio no es perfecto, el juez etiqueta lo que salió mal con hasta 5 etiquetas de fallo de una lista fija.
        El reporte las cuenta en toda la llamada, para que los problemas repetidos destaquen.
      </P>
      <Table
        caption="Etiquetas de fallo"
        head={["Etiqueta", "¿Limita el criterio a la banda 2?"]}
        rows={[
          ["Información inventada", "Sí"],
          ["Información incorrecta", "Sí"],
          ["Instrucción ignorada", "Sí"],
          ["Inseguro o contrario a las políticas", "Sí"],
          ["Faltó pedir información", "No"],
          ["Tarea incompleta", "No"],
          ["Fuera de tema", "No"],
          ["Habla poco clara o poco natural", "No"],
          ["Respuesta cortada o incompleta", "No"],
          ["Respuesta lenta", "No"],
          ["Error de herramienta o de traza", "No"],
        ]}
      />
      <Callout locale="es" tone="warning" title="Los criterios limitados son graves">
        Las cuatro etiquetas que limitan dejan un criterio en la banda 2 (no cumple), por bueno que haya sido el resto de la
        respuesta. El reporte lo marca como <Badge tone="danger">Limitado</Badge> y dice por qué. Trata un criterio limitado
        como un defecto real, aunque la puntuación general se vea bien.
      </Callout>

      <H2 id="not-observable">Cuando un criterio no es observable</H2>
      <Table
        caption="Por qué un criterio puede no ser observable"
        head={["Motivo", "Qué hacer"]}
        rows={[
          ["Trazas no disponibles", "Un criterio de traza, pero sin trazas: vincula una conexión de Langfuse al agente, o espera las trazas y vuelve a evaluar."],
          ["Sin datos de tiempos", "Un criterio de tiempos, pero la llamada no tuvo turnos del agente medidos."],
          ["El juez no pudo observarlo", "La llamada nunca llegó a ese punto. Revisa que el escenario lleve hasta ahí, o que la llamada no haya terminado antes de tiempo."],
          ["El juez no dio un veredicto", "Poco frecuente. Vuelve a evaluar la corrida."],
        ]}
      />

      <H2 id="samples">Tres muestras, una mediana</H2>
      <P>
        Los modelos de lenguaje pueden responder distinto cada vez. Por eso el juez mira cada llamada tres veces, sobre
        exactamente la misma evidencia, y cada criterio se queda con la banda mediana. La tabla de criterios muestra las tres
        muestras como puntos pequeños.
      </P>
      <SamplesDiagram locale="es" />

      <H2 id="timing">Tiempos y latencia</H2>
      <P>
        La <Ui>latencia</Ui> es cuánto tarda el agente en empezar a responder: desde el momento en que quien llama deja de
        hablar hasta el primer sonido del agente. Un saludo no tiene latencia. El reporte muestra la mediana (p50) y la
        respuesta más lenta.
      </P>
      <P>
        Como guía aproximada para llamadas telefónicas, una mediana de menos de unos 1.5 segundos se siente ágil y las
        respuestas de más de unos 3 segundos se sienten rotas. Pero el juez solo aplica lo que dicen tus criterios de tiempos,
        así que escribe el número que esperas, como «Cada respuesta del agente empieza en menos de 2 segundos».
      </P>
      <H3 id="timing-text">Tiempos en agentes de texto</H3>
      <P>
        Un agente de texto no tiene sonido, así que sus tiempos empiezan cuando se envía el mensaje del usuario. El juez ve, en
        cada respuesta, el tiempo hasta el <Ui>primer texto</Ui> y hasta la <Ui>respuesta completa</Ui>, y las herramientas
        que ejecutó el agente. En modo <Ui>Stream</Ui>, la latencia es el tiempo hasta el primer texto; en modo{" "}
        <Ui>Invoke</Ui>, toda la respuesta llega de una vez, así que el primer texto y la respuesta completa coinciden. Una
        respuesta que se cortó (el agente falló antes de terminarla) se marca y nunca cuenta como respuesta medida. Escribe
        criterios de tiempos según lo que ve el usuario, como «Cada respuesta empieza en menos de 3 segundos».
      </P>

      <H2 id="evidence">Evidencia</H2>
      <P>Cada veredicto viene con la evidencia en la que se basó el juez: citas exactas y referencias a su origen.</P>
      <Table
        caption="Referencias de evidencia"
        head={["Referencia", "Apunta a"]}
        rows={[
          [<Code key="a">A3</Code>, "El 3.er turno del agente en la transcripción."],
          [<Code key="c">C2</Code>, "El 2.º turno de quien llama (en un agente de texto, el 2.º mensaje del usuario)."],
          [<Code key="t">T3</Code>, "La fila de tiempos del 3.er turno del agente (en un agente de texto, su 3.ª respuesta)."],
          [<Code key="r">R1</Code>, "La 1.ª traza de Langfuse de la llamada."],
        ]}
      />

      <H2 id="reading-results">Cómo leer los resultados</H2>
      <H3>Se ve bien</H3>
      <P>
        Ningún criterio obligatorio falló, una puntuación de 90 o más, nada limitado, todos los criterios observables y muestras
        que coinciden.
      </P>
      <H3>Necesita trabajo</H3>
      <P>
        Falló un criterio obligatorio, hay un criterio limitado, una puntuación de menos de unos 70, o la misma etiqueta (como
        respuesta lenta o tarea incompleta) se repite entre corridas.
      </P>
      <H3>No concluyente</H3>
      <P>
        Muchos criterios no observables, o una llamada que terminó antes de tiempo (fallida, o demasiado tiempo sin habla).
        Corrige la configuración antes de sacar conclusiones sobre el agente.
      </P>
      <Callout locale="es" tone="tip" title="Compara varias corridas">
        Una corrida es una muestra de uno. Lanza 3 o más corridas del mismo escenario y compara sus puntuaciones antes de
        decidir que un cambio ayudó.
      </Callout>

      <H2 id="suggestions-and-brief">Sugerencias y el informe</H2>
      <P>
        El juez también escribe <Ui>sugerencias</Ui>: cambios concretos, cada uno con un área (prompt, herramientas, flujo,
        latencia, voz u otra), una prioridad (alta, media o baja) y su evidencia. La pestaña <Ui>Traspaso</Ui> lo convierte
        todo en un <Ui>informe</Ui>: una nota en Markdown pensada para pegarse, por sí sola, en un agente de programación.
        Cubre los problemas encontrados, lo que no se pudo comprobar, los cambios a hacer (los más importantes primero), lo que
        funcionó y cómo verificar la corrección.
      </P>

      <H2 id="writing-criteria">Cómo escribir buenos criterios</H2>
      <Bullets>
        <li>Haz que cada uno se pueda comprobar en la llamada: «Confirma que la tarjeta está bloqueada», no «Es útil».</li>
        <li>Una idea por criterio. Divide «verifica la identidad y bloquea la tarjeta» en dos.</li>
        <li>Pon los números en los criterios de tiempos («menos de 2 segundos»).</li>
        <li>Reserva los criterios obligatorios para lo que de verdad define el éxito o el fracaso de la llamada.</li>
        <li>
          Si las muestras no coinciden a menudo en un criterio (el reporte dice{" "}
          <Badge tone="evaluator">Los jueces no coincidieron</Badge>), probablemente su redacción es ambigua: hazla más
          concreta.
        </li>
        <li>
          Conserva un criterio cuando lo edites, en lugar de eliminarlo y volver a agregarlo, para que los resultados sigan
          siendo comparables con el tiempo.
        </li>
      </Bullets>
    </>
  );
}
