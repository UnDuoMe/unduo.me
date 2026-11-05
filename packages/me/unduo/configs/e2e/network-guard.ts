import type { BrowserContext, Route } from "@playwright/test";

export type LoggedRequest = {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
};

/**
 * Decide where every request of a browser context goes. Hosts in `real` reach the
 * network, hosts in `mocks` are answered in this process, and anything else is
 * refused and recorded, so the test can never reach the real Duo or the real
 * school, or a host it didn't expect, and fails if the page tried to.
 */
export async function guardNetwork(
  context: BrowserContext,
  real: string[],
  mocks: Record<string, (route: Route) => Promise<void>>,
) {
  const requests: LoggedRequest[] = [];
  const refused: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const { protocol, hostname } = new URL(request.url());
    if (protocol === "file:") return route.continue();
    requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? "",
      headers: await request.allHeaders(),
    });
    const mock = mocks[hostname];
    if (mock) return mock(route);
    if (real.includes(hostname)) return route.continue();
    refused.push(`${request.method()} ${request.url()}`);
    return route.abort("blockedbyclient");
  });
  return { requests, refused };
}
