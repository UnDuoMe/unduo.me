import type { Route } from "@playwright/test";

/**
 * A stand-in for Duo's Universal Prompt, served in this process at a Duo host name no
 * customer has. Its three screens copy the live prompt's markup as seen on 2026-11-10
 * (`/frame/v4/auth/prompt` and `/frame/v4/auth/all_methods`): the same tags, ids, classes,
 * `data-testid`s, labels and the passcode field's attributes, but no branding, account or
 * device names, and every page has a fixture banner.
 *
 * Copied behavior: one page swaps screens with `history.pushState`; the method list renders
 * its rows about 160 ms after the list itself; the passcode field is focused as it appears.
 */
export const duoHost = "api-e2efake0.duosecurity.com";
const sid = "frameless-00000000-0000-4000-8000-000000000000";

type PromptOptions = {
  /** Where Duo opens: the method it picked for you, or a remembered passcode. */
  first?: "push" | "passcode";
  /** Whether "Other options" lists a Duo Mobile passcode. */
  duoMobile?: boolean;
};

export const promptUrl = ({ first = "push", duoMobile = true }: PromptOptions = {}) =>
  `https://${duoHost}/frame/v4/auth/prompt?${new URLSearchParams({
    sid,
    first,
    duoMobile: String(duoMobile),
  })}`;

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Duo Security</title>
<p class="fixture">Test fixture for UnDuo Autofill's test. Not a real sign-in page.</p>
<div class="app"><div class="main"><div class="card"><div id="auth-view-wrapper"></div></div></div></div>
<script>
  const options = new URLSearchParams(location.search);
  const sid = options.get("sid");
  const prompt = "/frame/v4/auth/prompt?sid=" + sid;
  const allMethods = "/frame/v4/auth/all_methods?sid=" + sid;
  const view = document.getElementById("auth-view-wrapper");
  /** What the test reads: each screen shown, and each focus of a passcode field. */
  window.fixture = { screens: [], focuses: [] };

  const row = (testId, label, description) =>
    '<li class="auth-method-wrapper all-auth-methods-row color-black" data-testid="' + testId + '">' +
    '<a class="auth-method auth-method-link display-flex" href="' + prompt + '">' +
    '<span class="method-body-with-description"><div class="row display-flex method-label">' + label +
    '</div><div class="row display-flex method-description"><span class="method-description-displayed">' +
    description + "</span></div></span></a></li>";

  const passcodeField = () => {
    const input = document.createElement("input");
    for (const [name, value] of Object.entries({
      name: "passcode-input", id: "passcode-input", class: "passcode-input border--is-interactive ",
      inputmode: "numeric", pattern: "[0-9]*", maxlength: "6", autocomplete: "off",
      "data-lpignore": "true", "data-1p-ignore": "true", value: "",
    })) input.setAttribute(name, value);
    input.addEventListener("focus", () =>
      window.fixture.focuses.push({ ignored: input.hasAttribute("data-1p-ignore") }));
    return input;
  };

  const screens = {
    push() {
      view.innerHTML =
        '<h1 id="header-text" tabindex="-1">Open Duo Mobile</h1>' +
        '<div class="row display-flex instruction-text"><p>You need to open the app to approve your Duo Push notification…</p></div>' +
        '<div class="row display-flex align-flex-justify-content-center verification-code">000</div>' +
        '<p class="loader-text">Waiting for approval…</p>' +
        '<div class="row display-flex other-options-link align-flex-justify-content-center">' +
        '<a class="button--link " href="' + allMethods + '">Other options</a></div>';
    },
    methods() {
      view.innerHTML =
        '<button class="button--link display-flex transition-link-back-button"><span>Back</span></button>' +
        '<h1 id="all-auth-methods-header-text" tabindex="-1">Other options to log in</h1>' +
        '<div class="auth-method-wrapper"><ul class="all-auth-methods-list "></ul></div>';
      const list = view.querySelector("ul");
      setTimeout(() => {
        if (!list.isConnected) return;
        list.innerHTML =
          row("test-id-push", "Duo Push", "Send to Android") +
          (options.get("duoMobile") === "false" ? "" : row("test-id-mobile-otp", "Duo Mobile passcode", "Enter a code from the Duo Mobile app")) +
          row("test-id-hardware-token", "Hardware token", "Enter a code from your hardware token") +
          row("test-id-bypass", "Bypass code", "Enter a code from your IT help desk");
      }, 160);
    },
    passcode() {
      view.innerHTML =
        '<h1 id="mobile-otp-prompt-header-text" tabindex="-1">Enter your passcode</h1>' +
        '<form><label for="passcode-input" class="passcode-input-label">Passcode</label>' +
        '<div class="row display-flex passcode-input-parent"></div>' +
        '<button type="submit" class="c--primary primary verify-button button--xlarge" disabled data-testid="verify-button">Verify</button></form>' +
        '<button class="button--link link other-options-link" aria-label="">Other options</button>';
      const input = passcodeField();
      view.querySelector(".passcode-input-parent").append(input);
      input.focus();
    },
  };

  const show = (screen, url) => {
    if (url) history.pushState(null, "", url);
    window.fixture.screens.push(screen);
    screens[screen]();
  };

  /** A re-render that swaps in a new field, still asking password managers to skip it. */
  window.fixture.remountPasscode = () => {
    const input = passcodeField();
    document.getElementById("passcode-input").replaceWith(input);
    input.focus();
  };

  view.addEventListener("click", (event) => {
    const target = event.target.closest("a, button");
    if (!target) return;
    event.preventDefault();
    if (target.matches(".other-options-link a, button.other-options-link")) show("methods", allMethods);
    else if (target.matches("li[data-testid='test-id-mobile-otp'] a")) show("passcode", prompt);
    else if (target.matches("li[data-testid='test-id-push'] a")) show("push", prompt);
  });

  show(options.get("first") === "passcode" ? "passcode" : "push");
</script>
</html>`;

/** Answers every request: the prompt page at {@link duoHost}, and nothing anywhere else. */
export async function mockPrompt(route: Route) {
  const url = new URL(route.request().url());
  if (url.hostname === duoHost && url.pathname === "/frame/v4/auth/prompt") {
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: page });
  } else {
    await route.abort("blockedbyclient");
  }
}
