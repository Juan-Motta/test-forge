import { FlowDiagram } from "@/features/guide/diagrams";
import { Bullets, Callout, GuideLink, H2, Lead, P, Ui } from "@/features/guide/prose";
import { Badge } from "@/ui";

/** The Spanish body of the "overview" guide page. */
export function OverviewEs() {
  return (
    <>
      <Lead>
        TestForge prueba agentes tal como los encuentran tus clientes: en una llamada o en un chat. Un usuario simulado, el{" "}
        <strong className="text-evaluator-fg">evaluador</strong>, llama o le escribe a tu{" "}
        <strong className="text-agent-fg">agente evaluado</strong>, interpreta a una persona con un objetivo, y cada
        conversación queda grabada y luego la califica un juez.
      </Lead>

      <H2 id="what-is-duet">¿Qué es TestForge?</H2>
      <P>
        Construir un agente de voz es la parte fácil. Saber si sigue funcionando después de cambiar un prompt, una herramienta o
        un modelo es lo difícil: tendrías que llamarlo tú, una y otra vez, y escuchar con atención cada vez. TestForge hace esas
        llamadas por ti.
      </P>
      <P>
        Escribes los tipos de llamadas que te importan (un cliente que perdió una tarjeta, alguien con prisa, una persona que
        interrumpe todo el tiempo). TestForge hace esas llamadas de verdad, contra la propia conexión de voz de tu agente, y te
        devuelve la grabación, la transcripción, los tiempos y un reporte que dice qué salió bien, qué salió mal y qué cambiar.
      </P>

      <H2 id="voice-and-text">Agentes de voz y de texto</H2>
      <P>TestForge prueba dos tipos de agentes con los mismos escenarios, el mismo juez y los mismos reportes:</P>
      <Bullets>
        <li>
          <strong className="text-fg">Los agentes de voz</strong> se llaman por su WebSocket en tiempo real. El evaluador habla,
          escucha y puede interrumpir; obtienes una grabación, una transcripción y las latencias de respuesta.
        </li>
        <li>
          <strong className="text-fg">Los agentes de texto</strong> se contactan por la API de canales de Vivi (HTTP). El
          evaluador escribe cada mensaje como el usuario y lee la respuesta; obtienes la transcripción del chat con las
          herramientas que ejecutó el agente y cuánto tardó cada respuesta en empezar y en terminar. No hay audio.
        </li>
      </Bullets>
      <P>
        Eliges el tipo al agregar el agente; los escenarios escritos para él se adaptan (un escenario de texto tiene un máximo
        de turnos en lugar de ajustes de silencio e interrupciones).
      </P>

      <H2 id="who-is-it-for">¿Para quién es?</H2>
      <Bullets>
        <li>
          <strong className="text-fg">Equipos que construyen agentes de voz o de chat</strong> y quieren detectar regresiones
          antes que sus usuarios.
        </li>
        <li>
          <strong className="text-fg">Personas de producto y de QA</strong> que quieren escuchar llamadas, leer chats y
          reportes claros sin tocar código.
        </li>
        <li>
          <strong className="text-fg">Desarrolladores y agentes de programación con IA</strong> que quieren un informe listo
          de qué corregir, o que controlan TestForge desde scripts y la CI con su API.
        </li>
      </Bullets>

      <H2 id="the-idea">La idea: el evaluador es el usuario</H2>
      <P>
        La mayoría de las herramientas de prueba le envían texto a un modelo. TestForge, en cambio, actúa como alguien que llama
        por teléfono. El evaluador se conecta a tu agente con el mismo protocolo de voz por WebSocket que usa un cliente real,
        habla con una voz sintética real, escucha las respuestas y decide qué decir después, siguiendo una persona y un
        objetivo. Incluso puede cortar al agente a mitad de una frase, como hace la gente. Con un agente de texto hace lo mismo
        por escrito: envía cada mensaje por la API de canales del agente y mantiene todo el chat en un mismo hilo.
      </P>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>En toda la app,</span>
        <Badge tone="agent">el azul es tu agente</Badge>
        <span>y</span>
        <Badge tone="evaluator">el ámbar es el evaluador</Badge>
      </div>

      <H2 id="the-big-picture">El panorama general</H2>
      <P>Cada evaluación sigue el mismo camino, desde un escenario escrito hasta un reporte con el que puedes actuar.</P>
      <FlowDiagram locale="es" />
      <P>
        La página <GuideLink href="/guide/how-it-works">Cómo funciona</GuideLink> recorre cada paso en detalle.
      </P>

      <H2 id="what-you-get">Qué obtienes de cada corrida</H2>
      <Bullets>
        <li>
          <Ui>Una grabación</Ui> de toda la conversación (agentes de voz), con las dos voces en una sola línea de tiempo y las
          pausas e interrupciones tal como ocurrieron.
        </li>
        <li>
          <Ui>Una transcripción</Ui> con tiempos: cuánto tardó el agente en empezar a responder cada vez. En un agente de
          texto es un chat, con el tiempo hasta el primer texto y hasta la respuesta completa, y las herramientas que usó cada
          respuesta.
        </li>
        <li>
          <Ui>Una puntuación de 0 a 100</Ui> y un veredicto para cada uno de tus criterios de éxito, con citas como evidencia.
        </li>
        <li>
          <Ui>Sugerencias</Ui> ordenadas por prioridad y un <Ui>informe</Ui>: una nota lista para pegar en un agente de
          programación que explica qué cambiar.
        </li>
      </Bullets>

      <Callout locale="es" tone="note" title="Las corridas cuestan dinero">
        Cada corrida es una conversación real: abre una sesión con tu agente y usa modelos de lenguaje de pago (y, en agentes
        de voz, modelos de voz) para el evaluador y el juez. Empieza con una o dos corridas y ve aumentando.
      </Callout>

      <H2 id="where-next">A dónde ir después</H2>
      <P>
        ¿Es tu primera vez en TestForge? Sigue <GuideLink href="/guide/getting-started">Primeros pasos</GuideLink> para tu primera corrida.
        ¿Buscas una pantalla en particular? Consulta <GuideLink href="/guide/modules">Los módulos</GuideLink>. ¿Te desconcierta
        una puntuación? Lee <GuideLink href="/guide/scoring">Puntuación</GuideLink>.
      </P>
    </>
  );
}
