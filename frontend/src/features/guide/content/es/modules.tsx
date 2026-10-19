import type { ReactNode } from "react";
import { KpiMockup, VerdictMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, GuideLink, P, Region, Table, Ui } from "@/features/guide/prose";

// Anchor ids match the English page, so links to a module work in both languages.
const MODULES = [
  ["overview", "Resumen"],
  ["live-sessions", "Sesiones en vivo"],
  ["runs-and-reports", "Corridas y reportes"],
  ["scenarios", "Escenarios"],
  ["agents", "Agentes"],
  ["connections", "Conexiones"],
  ["api-keys", "Claves de API"],
  ["model-prices", "Precios de modelos"],
  ["api-docs-and-skill", "Documentación de la API y skill para agentes"],
] as const;

function Tips({ children }: { children: ReactNode }) {
  return (
    <Callout locale="es" tone="tip" title="Consejos">
      <Bullets>{children}</Bullets>
    </Callout>
  );
}

/** The Spanish body of the "modules" guide page. */
export function ModulesEs() {
  return (
    <>
      <P>
        La barra lateral de la app lista los módulos principales; a Conexiones, Claves de API y Precios de modelos se llega
        desde <Ui>Configuración</Ui>, donde también están tu tema y tu idioma. Esta página explica cada uno: para qué sirve, qué
        vas a encontrar ahí y algunos consejos. Ve directo a uno:
      </P>
      <nav aria-label="Módulos en esta página">
        <ul className="flex flex-wrap gap-2">
          {MODULES.map(([id, title]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="inline-flex min-h-9 items-center rounded-full border border-field-line px-3 text-sm text-body no-underline hover:border-line-strong hover:text-fg"
              >
                {title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Region id="overview" title="Resumen">
        <P>
          La página de inicio: cómo les fue a tus agentes en los últimos 7 días, de un vistazo. Está vacía hasta la primera
          corrida, y luego muestra:
        </P>
        <Bullets>
          <li>
            <Ui>Métricas clave</Ui>: las corridas de los últimos 7 días (comparadas con la semana anterior), la puntuación
            promedio del juez, los objetivos cumplidos (la proporción de corridas evaluadas cuyos criterios obligatorios se
            cumplieron todos) y la latencia mediana de respuesta del agente.
          </li>
          <li>
            <Ui>En vivo ahora</Ui>: las corridas en curso, con <Ui>Escuchar</Ui> para las llamadas y <Ui>Ver</Ui> para las
            conversaciones de texto.
          </li>
          <li>
            <Ui>Corridas recientes</Ui>, filtradas por <Ui>Todas</Ui>, <Ui>Fallida</Ui> o <Ui>Requiere revisión</Ui> (falló un
            criterio obligatorio o la puntuación es menor que 60).
          </li>
          <li>
            <Ui>Criterios más débiles</Ui>, los criterios con las puntuaciones promedio más bajas, y{" "}
            <Ui>Sugerencias listas para traspasar</Ui>.
          </li>
        </Bullets>
        <KpiMockup locale="es" />
        <Tips>
          <li>Usa el cuadro de búsqueda para encontrar corridas por escenario o por ID del hilo.</li>
          <li>
            <Ui>Nueva corrida</Ui> te lleva a tus escenarios para lanzar uno.
          </li>
        </Tips>
      </Region>

      <Region id="live-sessions" title="Sesiones en vivo">
        <P>
          Mira las corridas mientras ocurren y escucha las llamadas. Cada corrida en curso es una tarjeta (las llamadas muestran
          sus niveles de audio recientes); después de un lanzamiento llegas al lote, con su avance. La corrida de un agente de
          texto muestra en cambio el chat a medida que avanza: cada respuesta mientras se escribe, las herramientas que ejecuta
          y su tiempo hasta el primer texto.
        </P>
        <Bullets>
          <li>
            <Ui>Transcripción en vivo</Ui>: lo que dice cada lado, a medida que lo dice. Las interrupciones están marcadas.
          </li>
          <li>
            <Ui>Intención del evaluador</Ui>: lo que quien llama está por decir y por qué, antes de decirlo. Si el agente vuelve
            a hablar primero, la decisión se muestra como descartada. El evaluador en tiempo real decide mientras habla: sus
            palabras aparecen en su burbuja a medida que las dice, y el texto completo las reemplaza cuando termina.
          </li>
          <li>
            <Ui>Objetivos del evaluador</Ui>: el plan que el juez revisará después de la llamada.
          </li>
          <li>
            <Ui>Métricas de la llamada</Ui>: latencia promedio y más lenta del agente, turnos e interrupciones (en un agente de
            texto: tiempo hasta el primer texto, mensajes y herramientas usadas).
          </li>
          <li>
            <Ui>Escuchar</Ui> (solo llamadas), con una mezcla de audio (ambos, solo el agente o solo el evaluador) y un control
            de volumen.
          </li>
          <li>
            El ID completo del hilo de la corrida, debajo de su nombre, con un botón para copiarlo y buscar la llamada en los
            registros de tu agente mientras ocurre.
          </li>
        </Bullets>
        <P>
          Activa <Ui>Seguir y escuchar automáticamente</Ui> para que cada corrida se abra al empezar y, si es una llamada, se
          reproduzca sola. Con corridas en paralelo se queda en la actual hasta que termina y luego pasa a la siguiente corrida
          que siga en curso; aun así puedes elegir otra tarjeta. Tu navegador recuerda la elección. Después de recargar, es
          posible que el navegador necesite un clic (en <Ui>Escuchar</Ui>) antes de reproducir audio.
        </P>
        <Tips>
          <li>
            <Ui>Terminar llamada</Ui> detiene una llamada; <Ui>Detener todo</Ui> termina todas las llamadas de un lote y cancela
            las que siguen en cola. Las corridas terminadas conservan sus resultados.
          </li>
          <li>
            Si ves <Ui>Audio omitido</Ui>, tu conexión se quedó atrás: se descartó parte del audio para ti, pero la
            transcripción está completa y la grabación no se ve afectada.
          </li>
        </Tips>
      </Region>

      <Region id="runs-and-reports" title="Corridas y reportes">
        <P>
          Todas las corridas hechas, con su transcripción, sus tiempos y (en las llamadas) su audio. Filtra por{" "}
          <Ui>Estado</Ui>, <Ui>Escenario</Ui> o <Ui>Lote</Ui> (un lanzamiento), y alterna entre{" "}
          <Ui>Más recientes primero</Ui> y <Ui>Más antiguas primero</Ui> junto a los filtros; los filtros y el orden se
          guardan en la URL, así que un enlace o una recarga muestran la misma lista. Para ver un lanzamiento mientras corre,
          abre <Ui>Sesiones en vivo</Ui>.
        </P>
        <P>
          En pantallas anchas (1280 px o más) las corridas forman una tabla compacta. La celda <Ui>Escenario</Ui> tiene el
          nombre del escenario y, debajo, el agente, su tipo (Voz o Texto) y la persona; luego vienen <Ui>Duración</Ui>,{" "}
          <Ui>Turnos</Ui> (quien llama / agente), <Ui>Latencia p50</Ui> y <Ui>Costo</Ui>; <Ui>Resultado</Ui> muestra la
          puntuación y el resultado, y el estado solo cuando la corrida no terminó con normalidad (sigue en curso, falló, se
          canceló o se interrumpió); <Ui>Inicio</Ui> indica cuándo empezó. <Ui>En vivo</Ui> y <Ui>Cancelar</Ui> aparecen
          solo en las corridas que siguen en curso. En pantallas más angostas cada corrida es una tarjeta con las mismas
          cifras, y la tarjeta conserva el ID completo de la corrida con un botón para copiarlo. Haz clic en el nombre de un
          escenario para abrir el reporte de la corrida:
        </P>
        <VerdictMockup locale="es" />
        <Table
          caption="Partes del reporte de una corrida"
          head={["Parte", "Qué muestra"]}
          rows={[
            ["Veredicto", "Puntuación general, objetivos cumplidos, el resumen del juez, las etiquetas de fallo y los puntos fuertes."],
            ["Grabación de la llamada", "Toda la conversación como una sola grabación (las dos voces en una línea de tiempo), pistas de audio con marcadores de problemas, Descargar la conversación .wav y las pistas separadas."],
            ["Conversación (agentes de texto)", "En lugar de la grabación: el modo, los mensajes del usuario y las respuestas del agente, el tiempo hasta el primer texto (mediana y más lento), el tiempo hasta la respuesta completa, las herramientas usadas y por qué terminó la conversación."],
            ["Transcripción y criterios", "La conversación junto a una fila por criterio, con veredictos y enlaces a los turnos usados como evidencia. La transcripción de un agente de texto es un chat, con los tiempos de cada respuesta, sus herramientas y las respuestas que se cortaron."],
            ["Traza de Langfuse", "Las llamadas a modelos, las llamadas a herramientas y los errores del agente durante la llamada, como una línea de tiempo."],
            ["Sugerencias", "Cambios concretos para hacer, cada uno con un área (prompt, herramientas, flujo, latencia, voz) y una prioridad."],
            ["Traspaso", "Un informe para un agente de programación: cópialo o descárgalo como Markdown."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Volver a ejecutar</Ui> lanza el mismo escenario otra vez, tal como está ahora, en un lote nuevo. Es una llamada de
            pago, así que la app pregunta antes.
          </li>
          <li>
            <Ui>Volver a evaluar</Ui> califica la misma llamada otra vez (por ejemplo, después de vincular Langfuse); el resultado
            nuevo reemplaza al anterior.
          </li>
          <li>
            Haz clic en un marcador de problema de las pistas de audio, o en una referencia de evidencia, para saltar a ese
            momento de la transcripción.
          </li>
          <li>
            El encabezado del reporte muestra el ID completo del hilo con un botón para copiarlo: úsalo para buscar la llamada en
            los registros de tu propio agente.
          </li>
          <li>
            <Ui>Abrir trazas en Langfuse</Ui>, en el encabezado del reporte, abre la lista de trazas de Langfuse filtrada por el
            ID del hilo de la corrida, así ves todos los turnos de la llamada. Cuando esa lista no está disponible, el botón dice{" "}
            <Ui>Abrir la traza en Langfuse</Ui> y abre solo esa traza. Aparece cuando la corrida terminó y su agente tiene
            una conexión de Langfuse.
          </li>
        </Tips>
      </Region>

      <Region id="scenarios" title="Escenarios">
        <P>
          Tu biblioteca de conversaciones. Un escenario describe al usuario que interpreta el evaluador, qué sabe y qué quiere,
          y cómo califica el juez la llamada. Los escenarios viven en grupos: carpetas con título, descripción y etiquetas,
          que pueden tener escenarios de agentes distintos. La página lista los grupos con cuántos escenarios tiene cada uno,
          sus agentes y el último cambio; búscalos por título, descripción o etiqueta, o fíltralos por agente o etiqueta. <Ui>Nuevo escenario</Ui> abre el editor en un grupo nuevo y en blanco: nómbralo con
          el lápiz al final del título (o toma el nombre del escenario) y se crea al guardar. La página de un grupo y cada uno de
          sus escenarios llevan arriba el título, la descripción y las etiquetas del grupo, que se editan ahí mismo (los
          lápices y <Ui>Agregar etiqueta</Ui>), con los escenarios del grupo en la barra lateral. Mientras no elijas uno, la
          página del grupo ofrece <Ui>Correr todos</Ui>; un grupo vacío se puede eliminar desde ahí. El campo{" "}
          <Ui>Grupo</Ui> del escenario lo mueve a otro grupo.
          Cada grupo también lanza todos sus escenarios (reproducir) o empieza uno nuevo en él (más). En el editor,{" "}
          <Ui>Duplicar</Ui> y <Ui>Eliminar</Ui> (tras una confirmación) actúan sobre el escenario abierto. Por la API, un
          escenario creado sin grupo va al grupo con el nombre de su agente.
        </P>
        <Table
          caption="El editor de escenarios, sección por sección"
          head={["Sección", "Campos clave"]}
          rows={[
            ["1 · Agente evaluado y contexto", "Nombre, etiquetas, el agente evaluado, su grupo y el contexto que se suma al contexto compartido del agente."],
            ["2 · Persona que interpreta el evaluador", "Nombre de la persona, idioma y región (quien llama habla ese idioma), voz personalizada, temperamento, notas."],
            ["3 · Objetivo e instrucciones", "Objetivo (el juez lo revisa), cómo comportarse y los datos que conoce quien llama (solo los revela si se los piden)."],
            ["4 · Criterios de éxito para el juez", "Hasta 30 criterios: texto, Obligatorio o Deseable, fuente de evidencia (transcripción, tiempos o traza) y peso. Los pesos suman 100."],
            ["5 · Cuándo termina la llamada", "Duración máxima (30–1800 s, 360 de forma predeterminada), silencio máximo (5–120 s, 15 de forma predeterminada) y colgar cuando: objetivo cumplido o despedida, despedida, o duración máxima alcanzada. En un agente de texto: máximo de turnos (1–100 mensajes del usuario, 20 de forma predeterminada) en lugar del silencio máximo."],
            ["6 · Interrupciones", "Solo agentes de voz. Hasta 10: qué respuesta del agente cortar y después de cuántos segundos de ella."],
            ["7 · Evaluador", "Por etapas o voz a voz, el modelo de tiempo real, la conexión de voz del evaluador y la conexión del modelo del evaluador. En un agente de texto (sección 6): solo la conexión del modelo del evaluador, que es obligatoria."],
          ]}
        />
        <Tips>
          <li>
            Duplicar un buen escenario sirve para hacer una variante, como la misma solicitud de alguien molesto.
          </li>
          <li>
            <Ui>Exportar</Ui> (en un escenario abierto) lo muestra como texto para copiarlo o descargarlo como archivo{" "}
            <Code>.json</Code>; <Ui>Importar</Ui> (en esta página o en un escenario nuevo) pega o carga ese texto para prellenar
            un escenario nuevo, que revisas y guardas. El agente y las conexiones viajan por nombre: las que este servidor no
            tiene se listan para que las elijas.
          </li>
          <li>Usa etiquetas como «smoke» o «regression» para lanzar rápido el grupo correcto.</li>
          <li>
            Escribe criterios que el juez pueda comprobar en la llamada: «Confirma que la tarjeta está bloqueada» funciona mejor
            que «Es útil». Consulta <GuideLink href="/guide/scoring#writing-criteria">cómo escribir buenos criterios</GuideLink>.
          </li>
        </Tips>
      </Region>

      <Region id="agents" title="Agentes">
        <P>
          Los agentes que pruebas: cómo llegar a ellos y qué hacen. Cada uno es un agente de voz (se llama por su WebSocket) o
          un agente de texto (se contacta por la API de canales de Vivi); el tipo se elige al agregar el agente y no puede
          cambiar. Los escenarios se escriben para un agente, así que agrega uno primero.
        </P>
        <Table
          caption="Campos de un agente"
          head={["Campo", "Qué es"]}
          rows={[
            ["Nombre", "Único; los escenarios y las corridas se refieren al agente por él."],
            ["Qué hace este agente", "Lo comparten todos sus escenarios; el evaluador y el juez lo leen antes de cada corrida."],
            ["Tipo de agente", "Voz o Texto, se elige al agregar el agente."],
            ["Protocolo", "Voz: Detección automática (predeterminado), Live o Realtime."],
            ["URL del WebSocket", <>La dirección del agente, <Code>wss://</Code>, sin query string. <Code>ws://</Code> se permite para direcciones locales.</>],
            ["ID del canal, ID del usuario", "Voz: se envían al abrir la llamada, como lo hace tu propio cliente."],
            ["URL base, ID del canal", <>Texto: la dirección antes de <Code>/channelsApi</Code> (https; http solo para hosts locales) y el UUID del canal.</>],
            ["Modo", "Texto: Stream (latencia hasta el primer texto) o Invoke (latencia hasta la respuesta completa)."],
            ["Autenticación", <>Texto: Ninguna para un canal WEB como el canal de pruebas del portal, o Clave de API (se envía como <Code>vivi-api-key</Code>, solo de escritura).</>],
            ["Origen (opcional)", "Se envía como encabezado Origin cuando tu agente lo revisa."],
            ["Conexión de Langfuse", "Opcional. Las trazas del agente se obtienen después de cada corrida y se le pasan al juez."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Importar desde cURL</Ui> completa los campos de conexión a partir de una solicitud copiada en las herramientas
            para desarrolladores de tu navegador. El nombre y el contexto no se tocan.
          </li>
          <li>
            <Ui>Exportar</Ui> muestra un agente como texto (nunca su clave de API); <Ui>Importar</Ui> prellena un agente nuevo
            con ese texto o su archivo <Code>.json</Code>, listo para revisar y crear.
          </li>
          <li>
            <Ui>Probar la conexión</Ui> comprueba que el agente responde antes de que gastes dinero en corridas. En un agente de
            texto envía un mensaje corto, que llega al agente.
          </li>
          <li>El evaluador y el juez se configuran por escenario, no por agente.</li>
          <li>Un agente solo se puede eliminar cuando ningún escenario lo usa.</li>
        </Tips>
      </Region>

      <Region id="connections" title="Conexiones">
        <P>
          En <Ui>Configuración → Conexiones</Ui>: las credenciales que Duet usa para llegar a los proveedores. Los secretos son
          de solo escritura: se guardan cifrados y solo se muestran sus últimos 4 caracteres.
        </P>
        <Table
          caption="Proveedores de conexiones"
          head={["Proveedor", "Se usa para"]}
          rows={[
            ["OpenAI", "La voz de quien llama, el modelo de chat de quien llama, el evaluador en tiempo real y el juez."],
            ["Azure OpenAI", "Lo mismo, a través de tus deployments: un deployment de TTS, un deployment de chat para el evaluador y deployments de tiempo real para voz a voz."],
            ["Azure AI Speech", "Se puede guardar, pero todavía no se puede usar como la voz de quien llama."],
            ["Langfuse", "Lee las trazas de tu agente para que el juez pueda revisar las llamadas a herramientas, los modelos y los errores."],
          ]}
        />
        <Tips>
          <li>
            <Ui>Probar la conexión</Ui> comprueba los valores con el proveedor. En una conexión guardada, deja la clave en blanco
            para probar la que está guardada.
          </li>
          <li>El proveedor de una conexión no puede cambiar; crea una conexión nueva en su lugar.</li>
        </Tips>
      </Region>

      <Region id="api-keys" title="Claves de API">
        <P>
          En <Ui>Configuración → Claves de API</Ui>: las claves permiten que scripts, la CI o un agente de IA usen Duet sin
          iniciar sesión. Una clave actúa como tú.
        </P>
        <Bullets>
          <li>
            <Ui>Crear clave de API</Ui>: ponle un nombre (dónde se usa, como «CI nocturna») y un vencimiento (nunca, 30, 90 o
            365 días).
          </li>
          <li>La clave completa se muestra solo una vez, justo después de crearla. Cópiala en los secretos de tu CI.</li>
          <li>La tabla muestra cuándo se creó cada clave, cuándo se usó por última vez y cuándo vence.</li>
          <li>
            El ícono de papelera en la fila de una clave la revoca: después de confirmar con <Ui>Revocar clave</Ui>, la clave
            deja de funcionar de inmediato. No se puede deshacer.
          </li>
        </Bullets>
      </Region>

      <Region id="model-prices" title="Precios de modelos">
        <P>
          En <Ui>Configuración → Precios de modelos</Ui>: los precios por token que Duet usa para estimar cuánto cuesta cada
          evaluación. El reporte de cada corrida muestra el <Ui>Costo de la evaluación</Ui> (el evaluador más el juez, nunca tu
          agente) y la lista de corridas tiene una columna <Ui>Costo</Ui> compacta.
        </P>
        <Bullets>
          <li>
            Los precios son en USD por 1M de tokens, por modelo y tipo de token (texto o audio; entrada, entrada en caché o
            salida). Empiezan como los precios de lista publicados por OpenAI; edítalos para que coincidan con tu contrato.
            Azure OpenAI puede ser distinto, así que los costos son aproximados.
          </li>
          <li>
            El juez cuenta cada muestra de cada evaluación, incluidas las reevaluaciones. Las llamadas por etapas no ponen
            precio al audio de TTS (el endpoint de voz no informa el uso), así que su costo termina con un <Code>+</Code>.
          </li>
          <li>Las corridas anteriores a que se registraran los costos muestran un guion.</li>
        </Bullets>
      </Region>

      <Region id="api-docs-and-skill" title="Documentación de la API y skill para agentes">
        <P>
          <Ui>Documentación de la API</Ui> en la barra lateral abre la referencia de Swagger en <Code>/api/docs</Code>: cada
          endpoint, sus campos y sus respuestas, y se puede leer sin iniciar sesión. La tarjeta <Ui>Skill para agentes</Ui> en
          la página de claves de API le da a un agente de IA todo lo que necesita para usar la API: conceptos, flujos y cómo leer
          los resultados.
        </P>
        <P>
          Cómo combinar todo esto se explica en <GuideLink href="/guide/automation">Automatización</GuideLink>.
        </P>
      </Region>
    </>
  );
}
