export function finalizeHtml(
  source: string,
  published?: { stylesheets?: Record<string, string>; assetBase?: string },
): string;
export function validateStylesheet(css: string): void;
export function validateScript(code: string): string;
