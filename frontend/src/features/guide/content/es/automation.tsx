import { Bullets, Callout, Code, GuideLink, H2, H3, P, Step, Steps, Table, Ui } from "@/features/guide/prose";
import { CodeBlock } from "@/ui";

const AUTH_HEADER = "Authorization: Bearer ve_xxxxxxxx_<secret>";

const LAUNCH = `# Guarda la clave en una variable de entorno; nunca la pegues en archivos ni registros.
curl -s -X POST "$DUET_URL/api/runs" \\
  -H "Authorization: Bearer $DUET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"scenarioIds": ["<scenario id>"], "repetitions": 3, "concurrency": 1, "label": "nightly"}'`;

const FOLLOW = `# El lote: su estado y el de cada corrida, el estado de su evaluación y su puntuación
curl -s "$DUET_URL/api/runs/batches/<batch id>" -H "Authorization: Bearer $DUET_API_KEY"

# La evaluación del juez de una corrida: puntuación, veredictos, sugerencias e informe
curl -s "$DUET_URL/api/runs/<run id>/judgement" -H "Authorization: Bearer $DUET_API_KEY"`;

const SKILL = `curl -s "$DUET_URL/api/skill" -o SKILL.md          # la guía como un solo archivo Markdown
curl -s "$DUET_URL/api/skill.zip" -o voice-evaluator.zip   # una carpeta de skill con la referencia completa de la API`;

/** The Spanish body of the "automation" guide page. */
export function AutomationEs() {
  return (
    <>
      <P>
        Todo lo que haces en la app también se puede hacer con la API HTTP de Duet: lanzar corridas desde la CI después de cada
        despliegue, reunir puntuaciones en un script o dejar que un agente de programación con IA ejecute un escenario, lea el
        informe y corrija tu agente. Tres cosas lo hacen posible.
      </P>
      <Table
        caption="Las tres herramientas de automatización"
        head={["Herramienta", "Qué es", "Dónde"]}
        rows={[
          ["Claves de API", "Permiten que un script o un agente actúe como tú, sin iniciar sesión.", "Configuración → Claves de API"],
          ["Referencia de Swagger", "Cada endpoint con sus campos y sus respuestas.", <Code key="docs">/api/docs</Code>],
          ["Skill para agentes", "Una guía escrita para agentes de IA: conceptos, flujos y cómo leer los resultados.", <Code key="skill">/api/skill</Code>],
        ]}
      />

      <H2 id="api-keys">1. Crea una clave de API</H2>
      <Steps>
        <Step title="Abre Configuración → Claves de API y elige Crear clave de API.">
          Ponle el nombre del lugar donde se va a usar («CI nocturna») y elige cuándo vence.
        </Step>
        <Step title="Copia la clave enseguida.">
          Se muestra solo una vez. Guárdala como secreto en tu CI o en una variable de entorno.
        </Step>
        <Step title="Envíala en cada solicitud.">
          <CodeBlock code={AUTH_HEADER} label="Encabezado Authorization con una clave de API" />
        </Step>
      </Steps>
      <Callout locale="es" tone="warning" title="Trata las claves como contraseñas">
        Una clave actúa como tú. Nunca la subas al repositorio ni la imprimas en los registros. Si se filtra, usa{" "}
        <Ui>Revocar</Ui>: las solicitudes que la usen se rechazan de inmediato.
      </Callout>

      <H2 id="swagger">2. Explora la API en Swagger</H2>
      <P>
        Abre{" "}
        <a href="/api/docs" target="_blank" rel="noopener noreferrer">
          la referencia de la API (Swagger)
        </a>{" "}
        desde la parte superior de esta guía o desde <Ui>Documentación de la API</Ui> en la barra lateral de la app. Es pública,
        siempre coincide con la versión en ejecución y lista cada endpoint. El esquema sin procesar está en{" "}
        <Code>/api/openapi.json</Code>, útil para generar un cliente.
      </P>
      <P>Algunas convenciones que valen en todas partes:</P>
      <Bullets>
        <li>Los nombres de los campos están en camelCase, los ID son UUID y las horas están en UTC.</li>
        <li>Las listas de corridas y de lotes están paginadas y empiezan por lo más reciente.</li>
        <li>
          Los errores son simples: <Code>401</Code> para una clave que falta o es incorrecta, <Code>404</Code> para un ID
          desconocido, <Code>409</Code> para un conflicto (como un nombre que ya está en uso) y <Code>422</Code> para una
          entrada no válida, que señala el campo.
        </li>
      </Bullets>

      <H2 id="typical-flow">3. Un flujo típico</H2>
      <P>Lanza un lote, espera a que termine y luego lee los resultados:</P>
      <CodeBlock code={LAUNCH} label="Lanzar un lote con curl" tone="command" />
      <P>
        La respuesta es el lote nuevo con sus corridas en cola. Consúltalo cada 10 a 15 segundos hasta que su estado sea
        completado o cancelado, y luego lee la evaluación del juez de cada corrida (deja unos minutos más, hasta unos 20 con
        Langfuse):
      </P>
      <CodeBlock code={FOLLOW} label="Seguir un lote y leer una evaluación del juez con curl" tone="command" />
      <P>
        La evaluación del juez contiene la puntuación general, si falló un criterio obligatorio, el veredicto de cada criterio y
        el <Ui>informe</Ui>. Qué significa cada campo está en <GuideLink href="/guide/scoring">Puntuación</GuideLink>. Para
        seguir una corrida turno por turno en lugar de consultarla una y otra vez, la API también ofrece un stream en vivo por
        WebSocket; la referencia de Swagger y la skill para agentes lo describen.
      </P>
      <Callout locale="es" tone="note" title="Acciones de pago">
        Lanzar, volver a ejecutar y volver a evaluar llaman a proveedores de pago. Un lote cuesta aproximadamente escenarios ×
        repeticiones llamadas, y cada evaluación del juez hace 3 llamadas al modelo juez. Leer corridas, transcripciones y
        reportes es gratis.
      </Callout>

      <H2 id="agent-skill">4. Dale la skill a un agente de IA</H2>
      <P>
        La <Ui>skill para agentes</Ui> le enseña a un agente de programación con IA (como Claude Code) a usar Duet: qué son los
        escenarios, las corridas y las evaluaciones del juez, los flujos de arriba con las solicitudes exactas y cómo leer los
        resultados. Siempre coincide con la versión en ejecución y cualquiera puede obtenerla sin una clave.
      </P>
      <H3>Cómo obtenerla</H3>
      <Bullets>
        <li>
          En la app: <Ui>Configuración → Claves de API</Ui>, la tarjeta <Ui>Skill para agentes</Ui>. Copia las URL, copia un
          comando listo para guardarla o elige <Ui>Descargar skill (.zip)</Ui>.
        </li>
        <li>Desde una terminal:</li>
      </Bullets>
      <CodeBlock code={SKILL} label="Descargar la skill para agentes con curl" tone="command" />
      <P>
        Descomprime la carpeta en el directorio de skills de tu agente y dale al agente una clave de API mediante una variable
        de entorno. La skill le indica al agente que te pregunte antes de cualquier cosa que cueste dinero, como lanzar
        corridas.
      </P>

      <H2 id="judge-stability">Medir la estabilidad del juez</H2>
      <P>
        Si te interesa: quien administra el servidor puede evaluar varias veces una corrida terminada, sin guardar nada, para
        ver cuánto se mueve la banda de cada criterio. Cada repetición cuesta 3 llamadas al modelo juez.
      </P>
      <CodeBlock
        code="docker compose exec backend voice-eval judge-stability <run id> --times 3"
        label="Comando de estabilidad del juez"
        tone="command"
      />
    </>
  );
}
