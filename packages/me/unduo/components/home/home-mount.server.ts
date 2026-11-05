import { attributes } from "@-/me.unduo.lib.dom/server";
import { aiReplies } from "#ai-replies";

/**
 * The AI replies' screenshots as pinned files, in a `<template>` that the page's
 * script copies into its cards. `image` gives the attributes that load each one.
 */
export function homeMount({ image }: { image: (name: string) => Record<string, string> }) {
  const images = aiReplies.map(
    ({ id, name, model }) => `
    <img class="reply-shot" data-reply="${id}"${attributes({
      ...image(`ai-reply-${id}`),
      alt: `${name} (${model}) with the University of Toronto file and the prompt, then its reply`,
    })}>`,
  );
  return `<template id="ai-reply-images">${images.join("")}
  </template>`;
}
