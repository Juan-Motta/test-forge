import type { Api } from "./types";

/** The API on the connections page, open beside the other APIs (`/apis?api=<id>`). */
export const apiConnectionHref = (api: Pick<Api, "id">) => `/apis?api=${encodeURIComponent(api.id)}`;
/** The API's flow workspace: its flows, the flow editor and its runs. */
export const apiHref = (api: Pick<Api, "id">) => `/apis/${encodeURIComponent(api.id)}`;
/** Where a new flow of the API starts in the flow editor. */
export const newFlowHref = (api: Pick<Api, "id">) => `${apiHref(api)}?new=flow`;
/** One flow of the API, open in the flow editor. */
export const flowHref = (api: Pick<Api, "id">, flowId: string) => `${apiHref(api)}?flow=${encodeURIComponent(flowId)}`;
/** The run form of a flow (`run=new`), or one of its stored runs. */
export const runHref = (api: Pick<Api, "id">, flowId: string, runId: string) =>
  `${flowHref(api, flowId)}&run=${encodeURIComponent(runId)}`;
