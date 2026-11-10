import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

/** The built extension: `vp run build:extension` writes it. */
export const extensionDir = fileURLToPath(
  new URL("../../../../../apps/unduo-extension/dist", import.meta.url),
);
/** The release asset's name, the same for every version so a "latest" link keeps working. */
export const assetName = "unduo-autofill.zip";

type ZipFile = { name: string; data: Buffer };

/**
 * A zip of `files`, stored without compression, sorted by name, every entry dated
 * 1980-01-01 00:00 with mode 0644 and no extra fields. The same files always give the same
 * bytes, so anyone can rebuild the extension and compare the zip's SHA-256 with a release's.
 */
export function zipFiles(files: ZipFile[]): Buffer {
  const sorted = files.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const dosTime = 0;
  const dosDate = (1 << 5) | 1; // 1980-01-01
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4); // version needed: 1.0, stored
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 10, 4); // made by: Unix, 1.0
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Extra field, comment, disk number and internal attributes stay 0.
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: a 0644 file
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Zips the built extension, with its files at the zip's root, and names its version. */
export function packExtension(dir = extensionDir) {
  const names = readdirSync(dir);
  if (!names.includes("manifest.json")) {
    throw new Error(`No manifest.json in ${dir}. Run vp run build:extension first.`);
  }
  const files = names.map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    version: string;
  };
  const zip = zipFiles(files);
  return {
    zip,
    sha256: createHash("sha256").update(zip).digest("hex"),
    version: manifest.version,
  };
}
