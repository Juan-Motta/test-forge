import type { ReactNode } from "react";
import { Code, Definitions, GuideLink, H2, H3, P, Region, Ui } from "@/features/guide/prose";

function Item({ question, children }: { question: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel px-4 py-3.5">
      <H3>{question}</H3>
      <div className="flex flex-col gap-2 text-[15px] leading-7 text-body">{children}</div>
    </div>
  );
}

const GLOSSARY = [
  { term: "Agente", definition: "El agente evaluado: un agente de voz al que se llega por su WebSocket, o un agente de texto al que se llega por la API de canales de Vivi. Se muestra en azul." },
  { term: "Evaluador", definition: "El usuario simulado de Duet. Interpreta una persona y persigue un objetivo, hablando con una voz sintética a un agente de voz o escribiéndole a un agente de texto. Se muestra en ámbar." },
  { term: "Escenario", definition: "Un tipo de llamada: la persona, el objetivo, los datos, los criterios de éxito, las condiciones de fin, las interrupciones y la configuración del evaluador." },
  { term: "Persona", definition: "Quién llama: un nombre, un idioma (idioma y región), un temperamento y notas sobre sus hábitos." },
  { term: "Lote", definition: "Todo lo que crea un lanzamiento: una corrida por escenario y repetición." },
  { term: "Corrida", definition: "Una llamada real entre el evaluador y el agente, con su grabación, su transcripción, sus tiempos y su reporte." },
  { term: "Criterio", definition: "Algo que hace una buena llamada, con un peso y una fuente de evidencia (transcripción, tiempos o traza)." },
  { term: "Criterio obligatorio", definition: "Un criterio esencial: si no se cumple, la llamada cuenta como fallida sea cual sea la puntuación." },
  { term: "Banda", definition: "La calificación del 1 al 5 que el juez le da a un criterio, que fija sus puntos (de 25 a 100) y su veredicto." },
  { term: "Evaluación del juez", definition: "El resultado del juez para una corrida: puntuación, veredictos, evidencia, sugerencias e informe." },
  { term: "Informe", definition: "Una nota en Markdown, lista para pegar en un agente de programación, que explica qué cambiar en tu agente y por qué." },
  { term: "Interrupción", definition: "Hablar encima del otro lado (en inglés, barge-in). Se puede configurar a quien llama para que corte al agente a mitad de respuesta." },
  { term: "Latencia", definition: "Cuánto tarda el agente en empezar a responder después de que quien llama deja de hablar. En un agente de texto: desde el mensaje del usuario hasta el primer texto (Stream) o la respuesta completa (Invoke)." },
  { term: "ID del hilo", definition: "Un ID nuevo para cada corrida, que también se usa como ID de sesión de Langfuse del agente. Úsalo para encontrar la llamada en los registros de tu propio agente." },
  { term: "Conexión", definition: "Credenciales guardadas de un proveedor (OpenAI, Azure OpenAI, Azure AI Speech o Langfuse). Los secretos no se vuelven a mostrar." },
];

/** The Spanish body of the "faq" guide page. */
export function FaqEs() {
  return (
    <>
      <H2 id="troubleshooting">Solución de problemas</H2>
      <div className="flex flex-col gap-3">
        <Item question="No puedo iniciar sesión.">
          <P>
            Usa la dirección que te dio tu administrador y, en una instalación local, abre <Code>http://localhost:3000</Code>,
            no <Code>127.0.0.1</Code>. No hay registro público: las cuentas las crea un administrador. Después de muchos intentos
            fallidos, el inicio de sesión se pausa un tiempo para tu dirección; espera y vuelve a intentarlo.
          </P>
        </Item>
        <Item question="El lanzamiento dice «Algunos escenarios no se pueden ejecutar».">
          <P>
            A un escenario le falta lo que necesita quien llama: una conexión de voz, o un modelo de chat para el evaluador (una
            conexión de Azure OpenAI necesita un deployment de chat para eso). Abre el escenario, ve a <Ui>7 · Evaluador</Ui>,
            corrige las conexiones y vuelve a lanzar.
          </P>
        </Item>
        <Item question="Mi corrida falló con «No se pudo conectar con el agente».">
          <P>
            Duet no pudo llegar a la URL del WebSocket. Revísala en la página del agente y presiona{" "}
            <Ui>Probar la conexión</Ui>. Usa <Code>wss://</Code> para agentes remotos; <Code>ws://</Code> solo funciona con
            direcciones locales como <Code>localhost</Code>.
          </P>
        </Item>
        <Item question="«El agente nunca estuvo listo» o «Error de protocolo».">
          <P>
            La conexión se abrió, pero la sesión no empezó, o Duet no reconoció el protocolo del agente. Revisa el ID del canal,
            el ID del usuario y el origen (volver a importar un cURL reciente es la forma más fácil) y prueba a poner en{" "}
            <Ui>Protocolo</Ui> el que habla tu agente en lugar de Detección automática.
          </P>
        </Item>
        <Item question="«Falló la síntesis de voz» o «Falló el modelo del evaluador».">
          <P>
            La voz o el modelo de chat de quien llama devolvió un error. Abre <Ui>Configuración → Conexiones</Ui> y presiona{" "}
            <Ui>Probar la conexión</Ui> en las conexiones que usa el escenario. Un evaluador en tiempo real con Azure OpenAI
            también necesita un deployment de tiempo real para el modelo que elegiste.
          </P>
        </Item>
        <Item question="Mi agente de texto falla con «Access denied (HTTP 403)».">
          <P>
            El canal del agente rechazó el mensaje. En un canal API falta la <Code>vivi-api-key</Code> (una clave incorrecta da
            HTTP 401 en su lugar): pon <Ui>Autenticación</Ui> en <Ui>Clave de API</Ui> y guarda la clave. En un canal WEB, como
            el canal de pruebas del portal, se revisa el origen: deja <Ui>Origen</Ui> vacío o pon el portal o uno de los
            dominios permitidos del canal. Un 403 también aparece cuando la suscripción del espacio de trabajo no está activa.
          </P>
        </Item>
        <Item question="Mi agente de texto falla con «The agent refused the message (HTTP 422)».">
          <P>
            Los canales API y WEB exigen que el <Code>threadId</Code> sea un UUID. Duet siempre envía uno, así que un 422 suele
            significar que la URL base o el canal apuntan a otro servicio; revísalos, o vuelve a importar un cURL reciente, y
            presiona <Ui>Probar la conexión</Ui>.
          </P>
        </Item>
        <Item question="«The agent's stream ended before the reply finished (no on_chat_end event)».">
          <P>
            En modo Stream, cada respuesta debe terminar con el evento <Code>on_chat_end</Code>. Un stream que se detiene sin él
            es un fallo: el agente tuvo un error a mitad de la respuesta (un contexto que creció demasiado envía un mensaje corto
            y luego se detiene). La corrida falla, y el reporte conserva la respuesta parcial marcada como{" "}
            <Ui>Respuesta cortada</Ui>. Revisa las trazas del agente para ese ID del hilo. Un agente con un esquema de respuesta
            no puede usar stream (HTTP 409): cámbialo a <Ui>Invoke</Ui>.
          </P>
        </Item>
        <Item question="La evaluación del juez está tardando mucho.">
          <P>
            Sin Langfuse suele tardar unos minutos. Con Langfuse, Duet espera a que las trazas del agente dejen de cambiar, lo
            que puede tardar hasta unos 20 minutos después de la llamada. El reporte muestra cuánto tiempo lleva esperando.
          </P>
        </Item>
        <Item question="Un criterio dice «Trazas no disponibles».">
          <P>
            Es un criterio de traza, pero Duet no encontró trazas. Vincula una conexión de Langfuse al agente, comprueba que tu
            agente use el ID del hilo de la corrida como su ID de sesión de Langfuse y luego usa <Ui>Volver a evaluar</Ui> en la
            corrida.
          </P>
        </Item>
        <Item question="Quien llama nunca interrumpe, aunque configuré interrupciones.">
          <P>
            Las interrupciones solo funcionan con agentes que usan el protocolo Realtime; con otros, la corrida muestra una
            advertencia en su lugar. Revisa también que la respuesta del agente haya sido más larga que el punto de
            interrupción.
          </P>
        </Item>
        <Item question="El mismo escenario obtiene puntuaciones distintas.">
          <P>
            Cierta variación es normal: cada llamada es una conversación nueva. Lanza 3 o más corridas y compáralas. Si un
            criterio cambia todo el tiempo o muestra <Ui>Los jueces no coincidieron</Ui>, reescríbelo de forma más concreta.
            Consulta <GuideLink href="/guide/scoring#writing-criteria">cómo escribir buenos criterios</GuideLink>.
          </P>
        </Item>
        <Item question="No puedo eliminar un agente.">
          <P>Un agente solo se puede eliminar cuando ningún escenario lo usa. Elimina o mueve primero sus escenarios.</P>
        </Item>
        <Item question="Perdí una clave de API.">
          <P>
            Las claves se muestran solo una vez y no se pueden recuperar. Crea una nueva, actualiza tus scripts y revoca la clave
            anterior.
          </P>
        </Item>
      </div>

      <H2 id="faq">Preguntas frecuentes</H2>
      <div className="flex flex-col gap-3">
        <Item question="¿Editar un escenario cambia los resultados anteriores?">
          <P>
            No. Cada corrida guarda una instantánea de aquello con lo que se lanzó. Vuelve a ejecutar el escenario para probar la
            versión nueva.
          </P>
        </Item>
        <Item question="¿Cuánto cuesta una corrida?">
          <P>
            Cada corrida usa tu agente (una sesión real), el modelo de chat del evaluador (y, en las llamadas, su modelo de voz o
            de tiempo real) y el juez (3 llamadas al modelo por evaluación). El costo depende de tus proveedores y de la duración
            de la llamada; el panel de lanzamiento muestra cuántas llamadas estás por hacer. El reporte de cada corrida muestra
            el costo aproximado de la evaluación (evaluador y juez) según los precios de{" "}
            <Ui>Configuración → Precios de modelos</Ui>.
          </P>
        </Item>
        <Item question="¿Puedo detener una llamada?">
          <P>
            Sí: <Ui>Terminar llamada</Ui> (<Ui>Terminar conversación</Ui> en un agente de texto) en la vista en vivo,{" "}
            <Ui>Cancelar corrida</Ui> en una corrida o <Ui>Detener todo</Ui> para un lote completo. Las corridas canceladas no se
            evalúan; las corridas terminadas conservan sus resultados.
          </P>
        </Item>
        <Item question="¿Puedo descargar una grabación?">
          <P>
            Sí. En el reporte de la corrida, <Ui>Descargar la conversación .wav</Ui> te da las dos voces en una sola línea de
            tiempo. En <Ui>Pistas separadas</Ui> también puedes obtener cada lado por separado (esos dos archivos no están
            alineados en el tiempo).
          </P>
        </Item>
        <Item question="¿Qué idiomas puede hablar quien llama?">
          <P>
            El idioma del idioma y región de la persona, como <Code>en-US</Code> o <Code>es-MX</Code>, en la medida en que lo
            admitan los modelos de voz y de chat.
          </P>
        </Item>
        <Item question="¿Puedo usar Azure AI Speech para la voz de quien llama?">
          <P>
            Todavía no. Puedes guardar una conexión de Azure AI Speech, pero por ahora usa OpenAI o Azure OpenAI como voz.
          </P>
        </Item>
        <Item question="¿Hay un tema claro?">
          <P>
            Sí. Elige <Ui>Sistema, Claro u Oscuro</Ui> en la app, en <Ui>Configuración → Preferencias</Ui>, en la página de
            inicio de sesión o en el encabezado de esta guía. Sistema sigue a tu dispositivo. La elección se recuerda solo en
            este navegador.
          </P>
        </Item>
        <Item question="¿Puedo usar la app en español?">
          <P>
            Sí. Elige <Ui>EN o ES</Ui> en la app, en <Ui>Configuración → Preferencias</Ui>, en la página de inicio de sesión o en
            el encabezado de esta guía. Las pantallas de la app cambian de idioma; tus datos, como los nombres de los escenarios
            y las transcripciones, se quedan como se escribieron.
          </P>
        </Item>
        <Item question="¿Puedo ver las respuestas de un agente de texto tal como las envió?">
          <P>
            Sí. Las respuestas de los agentes de texto se muestran con formato Markdown (negritas, listas, enlaces, código).
            Elige <Ui>Sin formato</Ui> en <Ui>Configuración → Preferencias → Respuestas del agente</Ui> para verlas tal como se
            enviaron, con sus marcas. La elección se recuerda solo en este navegador.
          </P>
        </Item>
        <Item question="¿Quién puede leer esta guía?">
          <P>
            Cualquiera que pueda llegar a Duet: la guía y la referencia de la API no requieren iniciar sesión. Todo lo demás en
            la app y en la API sí.
          </P>
        </Item>
      </div>

      <Region id="glossary" title="Glosario">
        <Definitions items={GLOSSARY} />
      </Region>
    </>
  );
}
