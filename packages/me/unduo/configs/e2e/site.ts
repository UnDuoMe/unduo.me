/** The site under test: production, for now. */
export const site = process.env.UNDUO_E2E_URL ?? "https://unduo.me/";

/** The only hosts the test's browser can reach. Everything else is a mock or refused. */
export const realHosts = [new URL(site).hostname, "cdn.jsdelivr.net"];
