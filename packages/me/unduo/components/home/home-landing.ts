import { button, dialog, div, h2, li, ol, p, path, section, span, svg } from "@-/me.unduo.lib.dom";
import { type AiReply, aiReplies } from "#ai-replies";
import { steps } from "#home-intro";

/** Each screenshot's blob: URL, by its `data-image-src`. */
const images = new Map<string, Promise<string>>();

/**
 * Show an AI reply's screenshot: a blob: URL of the file at the image's
 * `data-image-src`, which `fetch` returns only if its SHA-256 matches
 * `data-image-integrity`. An image with no `data-image-src` already holds its picture.
 */
function showScreenshot(picture: HTMLImageElement) {
  const { imageSrc: url, imageIntegrity: integrity = "" } = picture.dataset;
  if (!url) return;
  if (!images.has(url))
    images.set(
      url,
      fetch(url, { integrity, credentials: "omit" })
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(url))))
        .then((blob) => URL.createObjectURL(blob)),
    );
  void images.get(url)!.then(
    (source) => (picture.src = source),
    () => {},
  );
}

/** A copy of a reply's screenshot from the page's `#ai-reply-images` template. */
function screenshotOf(id: AiReply["id"]) {
  const pinned = document
    .querySelector<HTMLTemplateElement>("#ai-reply-images")
    ?.content.querySelector<HTMLImageElement>(`[data-reply="${id}"]`);
  const picture = pinned?.cloneNode() as HTMLImageElement | undefined;
  if (picture) showScreenshot(picture);
  return picture;
}

const closeIcon = () =>
  svg(
    { width: "14", height: "14", viewBox: "0 0 14 14", "aria-hidden": "true" },
    path({ d: "M1 1l12 12M13 1L1 13", stroke: "currentColor", "stroke-width": "1.4" }),
  );
const checkIcon = () =>
  svg(
    { class: "reply-verdict-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
    path({
      d: "M3.5 8.5l3 3 6-7",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );

/**
 * What ChatGPT, Claude and Gemini said about the University of Toronto file:
 * each one's verdict and a sentence of its reply, with a screenshot of the
 * whole reply that opens larger.
 */
export function aiTestimonials() {
  const enlarged = div({ class: "viewer-image" });
  const viewer = dialog(
    {
      id: "reply-viewer",
      class: "dialog viewer",
      // A click beside the picture closes it.
      onclick: (event: MouseEvent) => event.target === viewer && viewer.close(),
    },
    button(
      {
        type: "button",
        class: "uk-modal-close-default uk-close",
        "aria-label": "Close",
        onclick: () => viewer.close(),
      },
      closeIcon(),
    ),
    enlarged,
  );
  const enlarge = (reply: AiReply, picture: HTMLImageElement) => {
    const copy = picture.cloneNode() as HTMLImageElement;
    showScreenshot(copy);
    enlarged.replaceChildren(copy);
    viewer.setAttribute("aria-label", `${reply.name}'s reply`);
    viewer.showModal();
  };
  const card = (reply: AiReply) => {
    const picture = screenshotOf(reply.id);
    return div(
      { class: "reply-card" },
      div(
        { class: "reply-head" },
        div(p({ class: "reply-name" }, reply.name), p({ class: "reply-model" }, reply.model)),
        span({ class: "reply-verdict" }, checkIcon(), `Safe: ${reply.verdict}`),
      ),
      p({ class: "reply-quote" }, `“${reply.quote}”`),
      picture &&
        button(
          {
            type: "button",
            class: "reply-shot-button",
            "aria-label": `See ${reply.name}'s whole reply`,
            onclick: () => enlarge(reply, picture),
          },
          picture,
          span({ class: "reply-shot-hint", "aria-hidden": "true" }, "See the whole reply"),
        ),
      p({ class: "reply-date" }, `Asked ${reply.askedOn}`),
    );
  };
  return section(
    { class: "landing-section", "aria-labelledby": "ai-replies-title" },
    div(
      { class: "section-intro" },
      h2({ class: "section-title", id: "ai-replies-title" }, "We asked ChatGPT, Claude and Gemini"),
      p(
        { class: "section-lead" },
        "Each read UnDuo's file for the University of Toronto in a temporary chat and answered the prompt you'll copy after choosing your university.",
      ),
    ),
    div({ class: "reply-grid" }, aiReplies.map(card)),
    viewer,
  );
}

/** The three steps of using UnDuo, numbered. */
export function howItWorks() {
  return section(
    { class: "landing-section", "aria-labelledby": "how-title" },
    div(
      { class: "section-intro" },
      h2({ class: "section-title", id: "how-title" }, "How UnDuo Works"),
    ),
    ol(
      { class: "how-steps" },
      steps.map((text, index) =>
        li(
          { class: "how-step" },
          span({ class: "how-number", "aria-hidden": "true" }, String(index + 1)),
          p({ class: "how-text" }, text),
        ),
      ),
    ),
  );
}

/** A way back to the search at the top, where every setup starts. */
export function getStarted(focusSearch: () => void) {
  return section(
    { class: "landing-cta" },
    button(
      {
        type: "button",
        class: "uk-button uk-button-primary btn-accent cta-button",
        onclick: focusSearch,
      },
      "Select Your University",
    ),
  );
}
