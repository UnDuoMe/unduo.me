import { createHash } from "node:crypto";
import { gitIdentity } from "@-/me.unduo.configs.git";

/**
 * Published assets (stylesheet, images and the setup plugin) live in a git
 * commit of their own, served by jsDelivr at its SHA. The commit's identity,
 * date and message are fixed, so its SHA follows from the file bytes alone:
 * the build can reference it before `vp run publish:assets` pushes it.
 */
export const cdnRepository = "UnDuoMe/unduo.me";
export const cdnIdentity = { ...gitIdentity, date: "1700000000 +0000" };
export const cdnMessage = "unduo web assets";

function objectId(type: string, body: Buffer): Buffer {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]))
    .digest();
}

/** The SHA git assigns a parentless commit holding exactly these files. */
export function cdnCommit(files: ReadonlyMap<string, Buffer>): string {
  for (const name of files.keys())
    if (!/^[\w.-]+$/.test(name)) throw new Error(`Invalid published file name: ${name}`);
  const names = [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const tree = objectId(
    "tree",
    Buffer.concat(
      names.map((name) =>
        Buffer.concat([Buffer.from(`100644 ${name}\0`), objectId("blob", files.get(name)!)]),
      ),
    ),
  );
  const who = `${cdnIdentity.name} <${cdnIdentity.email}> ${cdnIdentity.date}`;
  const commit = `tree ${tree.toString("hex")}\nauthor ${who}\ncommitter ${who}\n\n${cdnMessage}\n`;
  return objectId("commit", Buffer.from(commit)).toString("hex");
}

export function cdnBase(commit: string): string {
  return `https://cdn.jsdelivr.net/gh/${cdnRepository}@${commit}/`;
}
