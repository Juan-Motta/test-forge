import { LaunchPanelMockup } from "@/features/guide/mockups";
import { Bullets, Callout, Code, GuideLink, H2, P, Step, Steps, Ui } from "@/features/guide/prose";
import { CodeBlock } from "@/ui";

const RUN_STACK = `cp .env.example .env          # luego completa POSTGRES_PASSWORD y VOICE_EVAL_MASTER_KEY
docker compose up --build -d  # inicia la base de datos, el backend, la app web y el proxy
docker compose exec backend voice-eval create-user --email you@example.com --display-name "You"`;

/** The Spanish body of the "getting-started" guide page. */
export function GettingStartedEs() {
  return (
    <>
      <P>
        Esta página te lleva de cero a tu primera corrida evaluada. Sigue el orden que espera la app: primero las credenciales,
        luego el agente, luego un escenario y después un lanzamiento. Calcula unos 20 minutos, la mayor parte escribiendo tu
        primer escenario.
      </P>

      <H2 id="before-you-start">Antes de empezar</H2>
      <Bullets>
        <li>
          Un agente de voz que hable por un WebSocket (la misma conexión que usa tu cliente web o telefónico), o un agente de
          texto accesible por la API de canales de Vivi.
        </li>
        <li>
          Una cuenta de <Ui>OpenAI</Ui> o de <Ui>Azure OpenAI</Ui>: TestForge la usa para la voz de quien llama, el cerebro del
          evaluador y el juez (un agente de texto no necesita voz).
        </li>
        <li>
          Opcional: un proyecto de <Ui>Langfuse</Ui> donde tu agente escriba sus trazas, para que el juez también pueda revisar
          las llamadas a herramientas y los errores.
        </li>
      </Bullets>

      <H2 id="run-duet">1. Ejecuta TestForge</H2>
      <P>
        Si alguien ya ejecuta TestForge para tu equipo, pasa al siguiente paso. Si no, quien administre el servidor lo inicia con
        Docker desde la carpeta del proyecto:
      </P>
      <CodeBlock code={RUN_STACK} label="Comandos para iniciar TestForge con Docker" tone="command" />
      <P>
        El último comando crea el primer usuario (no hay registro público) y pide una contraseña de al menos 12 caracteres.
        Después, la app web está en <Code>http://localhost:3000</Code>.
      </P>
      <Callout locale="es" tone="warning" title="Usa localhost">
        Abre <Code>http://localhost:3000</Code>, no <Code>127.0.0.1</Code>: por seguridad, el servidor solo acepta inicios de
        sesión desde las direcciones con las que se configuró.
      </Callout>

      <H2 id="sign-in">2. Inicia sesión</H2>
      <P>
        Inicia sesión con el correo y la contraseña que creó para ti tu administrador. Llegas a <Ui>Resumen</Ui>, que queda
        vacío hasta la primera corrida.
      </P>

      <H2 id="add-connections">3. Agrega tus conexiones</H2>
      <P>
        Una conexión guarda las credenciales que TestForge usa para llegar a un proveedor. Los secretos se guardan cifrados y no se
        vuelven a mostrar; solo aparecen sus últimos 4 caracteres como pista.
      </P>
      <Steps>
        <Step title="Abre Configuración → Conexiones y elige Agregar conexión.">
          Elige el <Ui>Proveedor</Ui>: OpenAI, Azure OpenAI, Azure AI Speech o Langfuse.
        </Step>
        <Step title="Ponle un nombre y completa sus campos.">
          Para OpenAI basta con la clave de API; los valores predeterminados del modelo de voz y de la voz están bien. Para
          Azure OpenAI, agrega el endpoint, la versión de la API y tus deployments (un deployment de TTS para la voz, y un
          deployment de chat si también va a ser el cerebro de quien llama).
        </Step>
        <Step title="Presiona Probar la conexión y luego Crear conexión.">
          La prueba hace una pequeña solicitud al proveedor y te dice de inmediato si una clave o una dirección está mal.
        </Step>
      </Steps>
      <Callout locale="es" tone="tip">
        Con una conexión de OpenAI basta para empezar: puede ser la voz de quien llama, su modelo de chat y el juez. Agrega
        también una conexión de Langfuse si tu agente escribe trazas ahí.
      </Callout>

      <H2 id="add-an-agent">4. Agrega tu agente</H2>
      <P>
        El agente es el asistente que quieres probar. Ve a <Ui>Agentes</Ui>, elige <Ui>Agregar agente</Ui> y deja el tipo{" "}
        <Ui>Voz</Ui> para un agente de voz (para un agente de chat, consulta la siguiente sección).
      </P>
      <Steps>
        <Step title="Importa desde cURL (la forma más rápida).">
          En tu navegador, abre el cliente web de tu agente, abre las herramientas para desarrolladores, busca su solicitud de
          WebSocket en la pestaña Network, haz clic derecho sobre ella y cópiala como cURL. Pégala en{" "}
          <Ui>Importar desde cURL</Ui> y presiona <Ui>Importar</Ui>: se completan la URL del WebSocket, el ID del canal, el ID
          del usuario y el origen.
        </Step>
        <Step title="Ponle un nombre y describe qué hace.">
          La descripción (<Ui>Qué hace este agente</Ui>) la comparten todos los escenarios de este agente: el evaluador y el juez
          la leen antes de cada llamada.
        </Step>
        <Step title="Deja Protocolo en Detección automática.">
          TestForge averigua en cada corrida qué protocolo de voz habla tu agente. Elige uno solo para omitir esa comprobación.
        </Step>
        <Step title="Opcionalmente, vincula una conexión de Langfuse y luego presiona Crear agente.">
          Con Langfuse vinculado, el juez también lee las trazas del agente de cada llamada.
        </Step>
        <Step title="Presiona Probar la conexión.">
          TestForge llama al agente como en una corrida real, espera a que la sesión esté lista (como máximo 8 segundos) y cuelga sin
          enviar audio. Ves cada paso y cuánto tardó la conexión.
        </Step>
      </Steps>
      <Callout locale="es" tone="note" title="Probar un agente en tu propia máquina">
        Usa <Code>ws://localhost:…</Code>: <Code>ws://</Code> sin cifrar funciona con direcciones locales. Cuando TestForge se
        ejecuta en Docker, llega a tu máquina automáticamente.
      </Callout>

      <H2 id="add-a-text-agent">Agregar un agente de texto</H2>
      <P>
        A un agente de texto se llega por la API de canales de Vivi: TestForge envía cada mensaje como una solicitud HTTP a{" "}
        <Code>{"{base URL}/channelsApi/{channelId}/stream"}</Code> (o <Code>/invoke</Code>) y lee la respuesta. En{" "}
        <Ui>Agregar agente</Ui>, elige el tipo <Ui>Texto</Ui>.
      </P>
      <Steps>
        <Step title="Importa desde cURL o completa los campos.">
          Pega un comando cURL de una solicitud a <Code>/channelsApi/…/invoke</Code> o <Code>/channelsApi/…/stream</Code>: se
          completan la URL base, el ID del canal, el modo, el origen y, si el comando lleva un encabezado{" "}
          <Code>vivi-api-key</Code>, la clave de API. Si no, ingresa la <Ui>URL base</Ui> (https; http sin cifrar solo para
          hosts locales) y el UUID del canal como <Ui>ID del canal</Ui>.
        </Step>
        <Step title="Elige el modo.">
          <Ui>Stream</Ui> recibe la respuesta a medida que se escribe, y la latencia es el tiempo hasta el primer texto.{" "}
          <Ui>Invoke</Ui> recibe toda la respuesta de una vez, y la latencia es el tiempo hasta la respuesta completa. Los
          agentes con un esquema de respuesta solo funcionan con Invoke.
        </Step>
        <Step title="Elige la autenticación.">
          <Ui>Ninguna</Ui> para un canal WEB, como el canal de pruebas del portal de cada agente: no necesita credenciales (si
          el canal revisa el origen, pon en <Ui>Origen</Ui> un dominio permitido). <Ui>Clave de API</Ui> para un canal API: la
          clave se envía en el encabezado <Code>vivi-api-key</Code>, se guarda cifrada y no se vuelve a mostrar.
        </Step>
        <Step title="Crea el agente y presiona Probar la conexión.">
          La prueba envía un mensaje corto en una conversación nueva y espera toda la respuesta. Ese mensaje sí llega a tu
          agente.
        </Step>
      </Steps>
      <Callout locale="es" tone="note" title="Escenarios para un agente de texto">
        El escenario de un agente de texto no tiene ajustes de voz: ni voz personalizada, ni interrupciones, ni voz del
        evaluador. Necesita una <Ui>Conexión del modelo del evaluador</Ui> (el modelo de chat que escribe los mensajes del
        usuario) y termina después de <Ui>Máximo de turnos</Ui> mensajes del usuario (20 de forma predeterminada) si nada lo
        termina antes.
      </Callout>

      <H2 id="write-a-scenario">5. Escribe tu primer escenario</H2>
      <P>
        Un escenario es un tipo de llamada. Ve a <Ui>Escenarios</Ui> y elige <Ui>Nuevo escenario</Ui>. El editor tiene siete
        secciones cortas:
      </P>
      <Steps>
        <Step title="Agente evaluado y contexto">Elige el agente y, si hace falta, agrega contexto que solo necesita este escenario.</Step>
        <Step title="Persona que interpreta el evaluador">
          Un nombre, un idioma y región como <Code>en-US</Code> o <Code>es-MX</Code> (quien llama habla ese idioma), un
          temperamento como amable, con prisa o molesto, y notas sobre sus hábitos.
        </Step>
        <Step title="Objetivo e instrucciones">
          Qué quiere quien llama («Que bloqueen mi tarjeta perdida»), cómo se comporta y los datos que conoce, como los últimos
          cuatro dígitos de la tarjeta. Los datos solo se revelan cuando el agente los pide.
        </Step>
        <Step title="Criterios de éxito para el juez">
          Cómo es una buena llamada, una oración por criterio, con un peso. Los pesos deben sumar exactamente 100. Marca los
          esenciales como <Ui>Obligatorio</Ui>.
        </Step>
        <Step title="Cuándo termina la llamada">
          La duración máxima, el silencio máximo y cuándo cuelga quien llama. Para un agente de texto: la duración máxima, el
          máximo de turnos y cuándo el evaluador termina la conversación.
        </Step>
        <Step title="Interrupciones">Opcional, solo agentes de voz: hace que quien llama corte al agente a mitad de respuesta.</Step>
        <Step title="Evaluador">
          Cómo habla quien llama. Deja <Ui>Por etapas</Ui>, elige tu conexión de OpenAI o de Azure OpenAI como{" "}
          <Ui>Voz del evaluador</Ui> y deja el modelo del evaluador en <Ui>La misma que la conexión de voz</Ui>.
        </Step>
      </Steps>
      <P>
        Presiona <Ui>Crear escenario</Ui>. Puedes volver y editarlo cuando quieras; las corridas anteriores conservan la
        versión con la que se lanzaron.
      </P>

      <H2 id="launch">6. Lanza</H2>
      <P>
        Desde el escenario (o desde la lista, con <Ui>Lanzar</Ui>), el panel de lanzamiento pregunta cuántas corridas hacer y
        cuántas pueden ejecutarse al mismo tiempo. Muestra cuántas llamadas son y una estimación aproximada de la duración
        total.
      </P>
      <LaunchPanelMockup locale="es" />
      <Callout locale="es" tone="tip" title="Empieza con poco">
        Lanza primero una sola corrida para comprobar que todo está bien conectado. Cuando funcione, usa 3 o más corridas por
        escenario: una llamada es solo una muestra de uno.
      </Callout>

      <H2 id="watch-live">7. Míralo en vivo</H2>
      <P>
        Después de lanzar, abre <Ui>Sesiones en vivo</Ui>. Cada corrida en curso tiene una tarjeta; abre una para ver la
        transcripción en vivo, la intención del evaluador (lo que está por decir y por qué) y sus métricas. En una llamada,
        presiona <Ui>Escuchar</Ui> para oírla y elige el agente, el evaluador o ambos; <Ui>Terminar llamada</Ui> la detiene
        antes. En un agente de texto, el chat aparece a medida que el agente escribe, con las herramientas que ejecuta;{" "}
        <Ui>Terminar conversación</Ui> la detiene antes.
      </P>

      <H2 id="read-the-report">8. Lee el reporte</H2>
      <P>
        Cuando termina la corrida, el juez la califica automáticamente. Suele tardar unos minutos, y hasta unos 20 con Langfuse
        (las trazas tardan en estar disponibles). Abre la corrida desde <Ui>Agentes</Ui> → <Ui>Corridas</Ui> para ver:
      </P>
      <Bullets>
        <li>La puntuación general, cuántos objetivos se cumplieron y el resumen del juez.</li>
        <li>
          La grabación de la llamada (o, en un agente de texto, las métricas de la conversación), la transcripción y la tabla de
          criterios, con una fila por criterio y su evidencia.
        </li>
        <li>La traza de Langfuse del agente, las sugerencias y el informe de traspaso para un agente de programación.</li>
      </Bullets>
      <P>
        Aprende a leer cada parte en <GuideLink href="/guide/scoring">Puntuación</GuideLink>.
      </P>
    </>
  );
}
