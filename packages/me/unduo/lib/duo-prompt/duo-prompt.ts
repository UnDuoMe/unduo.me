/**
 * Duo's Universal Prompt, as served on 2026-11-10 at
 * `https://api-XXXXXXXX.duosecurity.com/frame/v4/auth/prompt?sid=…` (one page that
 * swaps screens without reloading):
 *
 * - It opens on the method Duo picked, often a Duo Push, whose screen has
 *   `<div class="other-options-link"><a href="/frame/v4/auth/all_methods?…">Other options</a></div>`.
 * - "Other options" lists the methods in `ul.all-auth-methods-list`. The Duo Mobile passcode
 *   is `<li data-testid="test-id-mobile-otp">` holding an `a.auth-method-link`, labelled
 *   "Duo Mobile passcode".
 * - Its screen has `<input id="passcode-input" autocomplete="off" data-lpignore="true"
 *   data-1p-ignore="true">`: Duo asks password managers to leave the field alone, so
 *   1Password never fills it.
 */
const passcodeInputSelector = "input#passcode-input, input[name='passcode-input']";
const methodListSelector = "ul.all-auth-methods-list";
const duoMobilePasscodeSelector = "li[data-testid='test-id-mobile-otp'] a";
const methodLinkSelector = "a.auth-method-link";
const otherOptionsSelector =
  ".other-options-link a, .other-options-link button, button.other-options-link";
const duoMobilePasscodeLabel = "Duo Mobile passcode";

/** Attributes that tell 1Password, LastPass, Bitwarden and Proton Pass to skip a field. */
export const passwordManagerIgnoreAttributes = [
  "data-1p-ignore",
  "data-lpignore",
  "data-bwignore",
  "data-protonpass-ignore",
];

/** Lets password managers fill Duo's passcode field and marks it as a one-time code. */
export function letPasswordManagersFill(input: HTMLInputElement) {
  for (const name of passwordManagerIgnoreAttributes) input.removeAttribute(name);
  // Compared first: setting an attribute to the value it has still counts as a change.
  if (input.getAttribute("autocomplete") !== "one-time-code") {
    input.setAttribute("autocomplete", "one-time-code");
  }
}

function duoMobilePasscodeLink(document: Document) {
  return (
    document.querySelector<HTMLElement>(duoMobilePasscodeSelector) ??
    [...document.querySelectorAll<HTMLElement>(methodLinkSelector)].find(
      (link) => link.querySelector(".method-label")?.textContent?.trim() === duoMobilePasscodeLabel,
    )
  );
}

/**
 * Follows Duo's prompt in `document` to the Duo Mobile passcode screen ("Other options",
 * then "Duo Mobile passcode") and keeps its field fillable by password managers. It stops
 * choosing for you at the passcode screen or as soon as you click anything yourself, so you
 * can still pick another method, and clicks nothing on a list without a Duo Mobile passcode.
 * Returns a function that stops it.
 */
export function followDuoPrompt(document: Document) {
  let choosing = true;
  const clicked = new WeakSet<Element>();
  const refocused = new WeakSet<Element>();

  const clickOnce = (element: HTMLElement) => {
    if (clicked.has(element)) return;
    clicked.add(element);
    element.click();
  };

  const step = () => {
    const input = document.querySelector<HTMLInputElement>(passcodeInputSelector);
    if (input) {
      choosing = false;
      letPasswordManagersFill(input);
      // Duo focuses the field as it appears, before this runs, so 1Password saw it while it
      // still said "ignore". Focusing it again lets 1Password offer the code.
      if (document.activeElement === input && !refocused.has(input)) {
        refocused.add(input);
        input.blur();
        input.focus();
      }
      return;
    }
    if (!choosing) return;
    if (document.querySelector(methodListSelector)) {
      // The list renders about 160 ms before its rows, so a missing row may still come.
      const link = duoMobilePasscodeLink(document);
      if (link) clickOnce(link);
      return;
    }
    const otherOptions = document.querySelector<HTMLElement>(otherOptionsSelector);
    if (otherOptions) clickOnce(otherOptions);
  };

  // A click from you (a trusted event) ends the choosing; this script's own clicks aren't trusted.
  const onClick = (event: Event) => {
    if (event.isTrusted) choosing = false;
  };
  document.addEventListener("click", onClick, true);

  const observer = new MutationObserver(step);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [...passwordManagerIgnoreAttributes, "autocomplete"],
  });
  step();

  return () => {
    observer.disconnect();
    document.removeEventListener("click", onClick, true);
  };
}
