export const template: URL;
export function installedPackage(name: string): { directory: string; version: string };
export function installedVersion(name: string): string;
export function integritySource(
  url: string,
): { name: string; version: string; file: string; source: string } | undefined;
export function assetIntegritySource(url: string): { file: string; source: string } | undefined;
export function packageName(specifier: string): string;
export function cdnPackageName(url: string): string;
export function readCdnSource(html?: string): {
  assets: Record<string, { kind: "style"; integrity: string }>;
};
