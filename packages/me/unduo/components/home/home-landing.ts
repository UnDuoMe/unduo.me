import {
  button,
  dialog,
  div,
  h2,
  h3,
  li,
  ol,
  p,
  path,
  section,
  span,
  strong,
  svg,
  ul,
} from "@-/me.unduo.lib.dom";
import { type AiReply, aiReplies } from "#ai-replies";
import { steps } from "#home-intro";
import { convertArt, phoneArt, portalArt } from "#how-art";

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
/** A chevron pointing down, or left or right for the carousel's arrows. */
const chevronIcon = (className = "reply-toggle-icon", d = "M5.5 8l4.5 4.5L14.5 8") =>
  svg(
    { class: className, viewBox: "0 0 20 20", "aria-hidden": "true" },
    path({
      d,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.6",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
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

/** Text with its `**bold**` phrases in bold. */
const withBold = (text: string) =>
  text.split(/\*\*(.+?)\*\*/).map((part, index) => (index % 2 ? strong(part) : part));

/**
 * A reply's Markdown as elements: paragraphs, `###` headings, `-` and `1.`
 * lists, and bold. Its text becomes text nodes, so a reply can't add markup.
 */
function replyText(markdown: string) {
  return markdown.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const items = (marker: RegExp) =>
      lines.every((line) => marker.test(line)) &&
      lines.map((line) => li(withBold(line.replace(marker, ""))));
    const heading = /^#{1,6} (.*)$/.exec(block);
    if (heading) return h3(withBold(heading[1]!));
    const bullets = items(/^[-*] /);
    if (bullets) return ul(bullets);
    const numbered = items(/^\d+\. /);
    if (numbered) return ol(numbered);
    return p(withBold(block));
  });
}

/**
 * What ChatGPT, Claude and Gemini said about the University of Toronto file, in
 * a carousel that shows one at a time: a screenshot of the conversation that
 * opens larger, and beside it the AI's verdict and its whole reply, cut short
 * until its chevron opens it in a box that scrolls. Arrows, a button per AI and
 * a swipe move between them.
 */
export function aiTestimonials() {
  const current = van.state(0);
  const count = aiReplies.length;
  /** Show reply `index`, wrapping around at either end. */
  const show = (index: number) => (current.val = (index + count) % count);
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
  const card = (reply: AiReply, index: number) => {
    const picture = screenshotOf(reply.id);
    const open = van.state(false);
    const text = div(
      {
        id: `reply-text-${reply.id}`,
        class: "reply-text",
        tabindex: () => (open.val ? "0" : "-1"),
      },
      replyText(reply.reply),
    );
    return div(
      {
        class: "reply-card",
        role: "group",
        "aria-roledescription": "slide",
        "aria-label": `${index + 1} of ${count}: ${reply.name}`,
        // The other slides are out of view, so out of reach too.
        inert: () => current.val !== index,
        "data-open": () => String(open.val),
      },
      picture &&
        button(
          {
            type: "button",
            class: "reply-shot-button",
            "aria-label": `Enlarge the screenshot of ${reply.name}'s reply`,
            onclick: () => enlarge(reply, picture),
          },
          picture,
          span({ class: "reply-shot-hint", "aria-hidden": "true" }, "Enlarge"),
        ),
      div(
        { class: "reply-body" },
        div(
          { class: "reply-head" },
          div(p({ class: "reply-name" }, reply.name), p({ class: "reply-model" }, reply.model)),
          span({ class: "reply-verdict" }, checkIcon(), `Safe: ${reply.verdict}`),
        ),
        text,
        button(
          {
            type: "button",
            class: "reply-toggle",
            "aria-controls": text.id,
            "aria-expanded": () => String(open.val),
            "aria-label": () => `${open.val ? "Hide" : "Show"} ${reply.name}'s whole reply`,
            onclick: () => {
              open.val = !open.val;
              // Closed, the reply shows its start again.
              if (!open.val) text.scrollTop = 0;
            },
          },
          chevronIcon(),
        ),
      ),
    );
  };
  /** Where a touch began, so a sideways swipe can move to the next or previous reply. */
  let touch: { x: number; y: number } | undefined;
  const carousel = div(
    {
      class: "reply-carousel",
      role: "region",
      "aria-roledescription": "carousel",
      "aria-label": "What the AIs said",
    },
    div(
      {
        class: "reply-viewport",
        ontouchstart: (event: TouchEvent) => {
          const { clientX: x, clientY: y } = event.touches[0]!;
          touch = { x, y };
        },
        ontouchend: (event: TouchEvent) => {
          const { clientX: x, clientY: y } = event.changedTouches[0]!;
          const dx = x - (touch?.x ?? x);
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(y - (touch?.y ?? y)))
            show(current.val + (dx < 0 ? 1 : -1));
          touch = undefined;
        },
      },
      div(
        { class: "reply-track", "aria-live": "polite", "data-slide": () => String(current.val) },
        aiReplies.map(card),
      ),
    ),
    div(
      { class: "reply-controls" },
      button(
        {
          type: "button",
          class: "reply-arrow",
          "aria-label": "Previous reply",
          onclick: () => show(current.val - 1),
        },
        chevronIcon("reply-arrow-icon", "M12 5.5L7.5 10l4.5 4.5"),
      ),
      div(
        { class: "reply-picker" },
        aiReplies.map((reply, index) =>
          button(
            {
              type: "button",
              class: "reply-pick",
              "aria-current": () => String(current.val === index),
              onclick: () => show(index),
            },
            reply.name,
          ),
        ),
      ),
      button(
        {
          type: "button",
          class: "reply-arrow",
          "aria-label": "Next reply",
          onclick: () => show(current.val + 1),
        },
        chevronIcon("reply-arrow-icon", "M8 5.5l4.5 4.5L8 14.5"),
      ),
    ),
  );
  return section(
    { class: "landing-section", "aria-labelledby": "ai-replies-title" },
    div(
      { class: "section-intro" },
      h2(
        { class: "section-title", id: "ai-replies-title" },
        "Fully safe, but don't take our word for it.",
      ),
      p(
        { class: "section-lead" },
        "You can audit UnDuo with all the major AIs: ChatGPT, Claude, and Gemini.",
      ),
      p({ class: "section-lead" }, "All three classify it as fully safe."),
    ),
    carousel,
    viewer,
  );
}

/** What each step involves, under its line, and its illustration. */
const stepDetails = [
  {
    art: portalArt,
    text: "Your UnDuo file walks you through your school's Duo device portal, where you add a new device. Duo then shows a QR code meant for its own app.",
  },
  {
    art: convertArt,
    text: "Paste that QR code into your UnDuo file. It activates the new device with Duo straight from your browser, then turns Duo's reply into a standard 2FA QR code.",
  },
  {
    art: phoneArt,
    text: "Any app that supports counter-based (HOTP) codes works, such as Google Authenticator, 2FAS, Aegis or FreeOTP. Its codes work wherever Duo asks for a passcode.",
  },
];

/**
 * The three steps of using UnDuo, stacked: each a card with an illustration on
 * one side and its line and details on the other, the sides alternating.
 */
export function howItWorks() {
  return section(
    { class: "landing-section", "aria-labelledby": "how-title" },
    div(
      { class: "section-intro" },
      h2({ class: "section-title", id: "how-title" }, "How UnDuo Works"),
    ),
    ol(
      { class: "how-steps" },
      steps.map((title, index) =>
        li(
          { class: "how-step" },
          stepDetails[index]!.art(),
          div(
            { class: "how-copy" },
            p({ class: "how-number" }, `Step ${index + 1}`),
            h3({ class: "how-title" }, title),
            p({ class: "how-text" }, stepDetails[index]!.text),
          ),
        ),
      ),
    ),
  );
}

/**
 * Get Started, at the bottom of the page: it scrolls back up to the search,
 * where every setup starts, and focuses it.
 */
export function getStarted(focusSearch: () => void) {
  return section(
    { class: "landing-cta" },
    button(
      {
        type: "button",
        class: "uk-button uk-button-primary btn-accent cta-button",
        onclick: focusSearch,
      },
      "Get Started",
    ),
  );
}
