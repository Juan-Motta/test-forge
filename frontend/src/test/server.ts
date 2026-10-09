import { setupServer } from "msw/node";

/** Origin the jsdom environment runs on; requests to `/api/*` resolve against it. */
export const TEST_ORIGIN = "http://localhost:3000";

export const apiUrl = (path: string) => `${TEST_ORIGIN}/api${path}`;

export const server = setupServer();
