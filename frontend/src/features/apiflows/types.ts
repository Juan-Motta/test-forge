/** Shapes of `/api/apis` and `/api/flows` (camelCase JSON). */

export type NamedRef = { id: string; name: string };

/** A plain header every step of the API's flows sends. */
export type ApiHeader = { name: string; value: string };

/** A secret as listed: its name and a masked hint (the value is revealed only on request). */
export type ApiSecret = { name: string; hint: string };

export type Api = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  baseUrl: string;
  headers: ApiHeader[];
  secrets: ApiSecret[];
  flowCount: number;
  /** Agents linked to at least one of its flows. */
  agents: NamedRef[];
  createdAt: string;
  updatedAt: string;
};

export type NewApi = {
  name: string;
  description?: string;
  tags?: string[];
  baseUrl: string;
  headers?: ApiHeader[];
  /** Values by name; sealed at rest by the backend. */
  secrets?: Record<string, string>;
};

/** A partial update; in `secrets` a value sets that secret and `null` removes it. */
export type ApiChanges = Partial<Omit<NewApi, "secrets">> & { secrets?: Record<string, string | null> };

/** `GET /api/apis/{id}/secrets`: every secret of the API, by name, in clear. */
export type RevealedSecrets = { secrets: Record<string, string> };

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type FlowInput = {
  name: string;
  type: "text" | "number" | "boolean";
  description: string;
  default: string | null;
  /** When set, AI writes the value from this description if the run gives none. */
  generate: string | null;
};

export type FlowCheck =
  | { type: "status"; equals: number }
  | { type: "path"; path: string; op: string; value: string | number | boolean | null }
  | { type: "duration"; maxMs: number };

export type FlowStep = {
  title: string;
  method: HttpMethod;
  path: string;
  query: { name: string; value: string }[];
  headers: ApiHeader[];
  body: unknown;
  saves: { name: string; path: string }[];
  checks: FlowCheck[];
};

export type Flow = {
  id: string;
  apiId: string;
  api: NamedRef;
  name: string;
  description: string;
  inputs: FlowInput[];
  steps: FlowStep[];
  agents: NamedRef[];
  createdAt: string;
  updatedAt: string;
  /** The flow's newest run, if it ever ran. */
  lastRun: FlowLastRun | null;
};

/** `Flow.lastRun`: the newest run of a flow, without its steps. */
export type FlowLastRun = { id: string; status: RunStatus; createdAt: string; durationMs: number };

/** `GET /api/flow-runs`: one run of any flow, with its flow and API names and no step bodies. */
export type FlowRunSummary = {
  id: string;
  flowId: string;
  flowName: string;
  apiId: string;
  apiName: string;
  status: RunStatus;
  stepCount: number;
  durationMs: number;
  createdAt: string;
};

export type FlowRunSummaryPage = { items: FlowRunSummary[]; total: number };

/** Filters of `GET /api/flow-runs` (newest first). */
export type FlowRunSummaryFilters = { status?: RunStatus; apiId?: string; limit: number; offset: number };

/** `GET /api/flows/{id}/curl`: a cURL command per step, in order. */
export type FlowCurls = { steps: { curl: string }[] };

/** Where a run's input value came from. */
export type InputSource = "given" | "default" | "generated";

export type RunStatus = "passed" | "failed";
export type StepStatus = "passed" | "failed" | "skipped";

/** A request as sent, with the API's secrets as `{{secret.<name>}}`. */
export type SentRequest = { method: HttpMethod; url: string; headers: ApiHeader[]; body: unknown };

export type ReceivedResponse = { status: number; headers: ApiHeader[]; body: unknown; sizeBytes: number };

export type CheckResult = { check: FlowCheck; passed: boolean; actual: unknown };

export type StepRun = {
  index: number;
  title: string;
  status: StepStatus;
  /** Null when the step was skipped, or failed before sending. */
  request: SentRequest | null;
  response: ReceivedResponse | null;
  durationMs: number | null;
  saved: Record<string, unknown>;
  checks: CheckResult[];
  error: string | null;
};

/** `POST /api/flows/{id}/runs`, `GET /api/flow-runs/{id}`: one run with its per-step trace. */
export type FlowRun = {
  id: string;
  flowId: string;
  status: RunStatus;
  inputs: { name: string; value: unknown; source: InputSource }[];
  steps: StepRun[];
  durationMs: number;
  createdAt: string;
};

/** Values by input name; an omitted input takes its default, or AI writes it. */
export type RunInputs = Record<string, string | number | boolean | null>;
