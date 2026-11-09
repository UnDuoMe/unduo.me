import { randomBytes } from "node:crypto";
import { QRCode } from "@-/com.npmjs.qrcode";
import type { Route } from "@playwright/test";
import { totp } from "#authenticator";

/**
 * A stand-in for UofT's sign-in, its UTORMFA enrollment site and the Duo frame in it,
 * served in this process at the real host names. Its pages follow the real ones as seen
 * on 2026-11-05: the same steps, headings, labels and URL shapes, but none of their
 * branding, and every page has a fixture banner. Every code and secret is made up.
 *
 * Seen on the real site: weblogin's form; the enrollment page holding Duo's frame at
 * `/frame/web/v1/auth`; the frame's device choice with "Send Me a Push" and "Enter a
 * Passcode"; "My Settings & Devices"; each step to the QR code; and the QR code itself,
 * whose image is `/frame/qr?value=CODE-BASE64HOST` and which holds the same value.
 *
 * Not seen, so made up: the passcode form after "Enter a Passcode", its error text, how a
 * new tablet is listed, and the activation email's form and contents.
 */

/** An account ID that no Duo customer has: `api-XXXXXXXX` is the shape the page accepts. */
const accountId = "e2efake0";
export const duoHost = `api-${accountId}.duosecurity.com`;
export const portalHost = "enroll.utormfa.utoronto.ca";
export const signInHost = "idpz.utorauth.utoronto.ca";

export const student = {
  username: "e2estudent",
  password: "not-a-real-password",
  email: "e2e.student@mail.utoronto.ca",
};

const signInPath = "/idp/profile/SAML2/Redirect/SSO";
const framePath = "/frame/web/v1/auth";

type Activation = {
  code: string;
  secret: string;
  /** Times Duo answered this code's activation; each QR code works once. */
  posts: number;
};

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (letter) => `&#${letter.charCodeAt(0)};`);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px system-ui; margin: 0; background: #f6f6f6; color: #333 }
  main { background: #fff; margin: 1em; padding: 1em; border-radius: 4px }
  .fixture { margin: 0; padding: .5em 1em; background: #333; color: #fff; font-size: 13px }
  label { display: block; margin: .5em 0 }
  iframe { width: 100%; height: 640px; border: 0 }
</style>
<p class="fixture">Test fixture for unduo's end-to-end test. Not a real sign-in page.</p>
<main>${body}</main>
</html>`;

/** A radio group whose Continue button stays off until a choice is made, as on the real tablet step. */
const choice = (group: string, name: string, labels: string[], checked?: string) => `
  <fieldset aria-label="${group}" style="border: 0; padding: 0">
    ${labels
      .map(
        (label) =>
          `<label><input type="radio" name="${name}" value="${escapeHtml(label)}"${
            label === checked ? " checked" : ""
          } /> ${escapeHtml(label)}</label>`,
      )
      .join("")}
  </fieldset>
  <button type="submit" name="back" value="1" formnovalidate>Back</button>
  <button type="submit" id="continue"${checked ? "" : " disabled"}>Continue</button>
  <script>
    for (const radio of document.querySelectorAll("input[type=radio]"))
      radio.addEventListener("change", () => (document.getElementById("continue").disabled = false));
  </script>`;

/** Duo's QR value: the code, then the API host in base64 without padding. */
const activationValue = (code: string) =>
  `${code}-${Buffer.from(duoHost).toString("base64").replace(/=+$/, "")}`;

export function mockDuo() {
  /** Whether weblogin has the student's password, and whether Duo's frame has verified them. */
  let signedIn = false;
  let verified = false;
  const devices = ["Mobile device named Android (XXX-XXX-0100)"];
  /** Fixture-only time window and replay tracking, not a claim about Duo's clock tolerance. */
  const usedWindows = new Set<number>();
  const activations: Activation[] = [];
  const posts: { url: string; fields: URLSearchParams; referer?: string }[] = [];
  const mail: { to: string; body: string }[] = [];

  const html = (route: Route, title: string, body: string, status = 200) =>
    route.fulfill({ status, contentType: "text/html; charset=utf-8", body: page(title, body) });
  /**
   * Never an HTTP redirect: Playwright doesn't route the request a redirect
   * leads to, so it would go to the real host. A new navigation is routed.
   */
  const redirect = (route: Route, location: string) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><script>location.replace(${JSON.stringify(location)})</script>`,
    });

  /** UTORMFA's enrollment site: weblogin first, then Duo's frame inside the page. */
  async function respondPortal(route: Route) {
    if (!signedIn) return redirect(route, `https://${signInHost}${signInPath}?execution=e1s1`);
    return html(
      route,
      "UTORMFA Enrollment Site",
      `<header><h1>UTORMFA Enrollment Site</h1></header>
      <h2>UTORMFA Enrollment and Device Management Portal</h2>
      <iframe title="Two-Factor Authentication" src="https://${duoHost}${framePath}?parent=${encodeURIComponent(`https://${portalHost}/`)}"></iframe>
      <p>Contact the tri-campus helpdesk support team for help.</p>`,
    );
  }

  async function respondSignIn(route: Route) {
    const request = route.request();
    if (request.method() === "POST") {
      const form = new URLSearchParams(request.postData() ?? "");
      if (
        form.get("j_username") === student.username &&
        form.get("j_password") === student.password
      ) {
        signedIn = true;
        return redirect(route, `https://${portalHost}/`);
      }
    }
    return html(
      route,
      "weblogin idpz",
      `<h1>weblogin idpz</h1>
      ${request.method() === "POST" ? '<p role="alert">Invalid UTORid or password.</p>' : ""}
      <form method="post">
        <label>UTORid / JOINid <input name="j_username" autocomplete="off" /></label>
        <label>Password <input name="j_password" type="password" autocomplete="off" /></label>
        <button type="submit" name="_eventId_proceed">log in</button>
      </form>`,
    );
  }

  /** Duo's frame: its prompt, then the device pages, the QR code and activation. */
  async function respondDuo(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const form = new URLSearchParams(request.postData() ?? "");
    const post = request.method() === "POST";

    if (url.pathname === "/frame/qr") {
      const value = url.searchParams.get("value") ?? "";
      return route.fulfill({
        contentType: "image/png",
        body: await QRCode.toBuffer(value, { width: 346, margin: 2 }),
      });
    }
    if (url.pathname.startsWith("/push/v2/activation/")) return respondActivation(route, url, form);
    if (!verified) return respondPrompt(route, url, form, post);
    return respondDevices(route, url, form, post);
  }

  /** The traditional Duo prompt in the enrollment page's frame. */
  function respondPrompt(route: Route, url: URL, form: URLSearchParams, post: boolean) {
    const done = () => {
      verified = true;
      return redirect(route, `${framePath}/devices`);
    };
    if (url.pathname === `${framePath}/push` && post) return done();
    if (url.pathname === `${framePath}/passcode`) {
      const secret = activations.at(-1)?.secret ?? "";
      const window = Math.floor(Date.now() / 30_000);
      if (
        post &&
        secret &&
        !usedWindows.has(window) &&
        devices.includes("Android tablet") &&
        totp(Buffer.from(secret), window * 30_000) === form.get("passcode")
      ) {
        usedWindows.add(window);
        return done();
      }
      return html(
        route,
        "Two-Factor Authentication",
        `<form method="post">
          ${post ? '<p role="alert">Incorrect passcode. Try again.</p>' : ""}
          <label>Passcode <input name="passcode" inputmode="numeric" autocomplete="off" /></label>
          <button type="submit">Log In</button>
        </form>`,
      );
    }
    return html(
      route,
      "Two-Factor Authentication",
      `<form method="post" action="${framePath}/push">
        <fieldset style="border: 0; padding: 0">
          <h1>Device:</h1>
          <select aria-label="Device">${devices.map((device) => `<option>${escapeHtml(device.replace(/^\w+ device named /, ""))}</option>`).join("")}<option>Token</option></select>
        </fieldset>
        <h2>Choose an authentication method</h2>
        <button type="submit" formaction="${framePath}/passcode" formmethod="get">Enter a Passcode</button>
        <button type="submit">Send Me a Push</button>
      </form>`,
    );
  }

  function respondDevices(route: Route, url: URL, form: URLSearchParams, post: boolean) {
    const step = url.pathname.slice(`${framePath}/`.length);
    const chose = (value: string, next: string, back: string) =>
      post && form.get("back")
        ? redirect(route, back)
        : post && form.has(value)
          ? redirect(route, next)
          : undefined;
    switch (step) {
      case "device-type":
        return (
          (post && form.get("back") && redirect(route, `${framePath}/devices`)) ||
          (post && form.get("device") === "Tablet (iPad, Nexus 7, etc.)"
            ? redirect(route, `${framePath}/tablet-type`)
            : post && form.get("device")
              ? html(route, "Enter your phone number", "<h1>Enter your phone number</h1>")
              : html(
                  route,
                  "What type of device are you adding?",
                  `<form method="post"><h1>What type of device are you adding?</h1>
                  ${choice("Device type", "device", ["Mobile phone RECOMMENDED", "Tablet (iPad, Nexus 7, etc.)", "Security Key (YubiKey, Feitian, etc.)"], "Mobile phone RECOMMENDED")}</form>`,
                ))
        );
      case "tablet-type":
        return (
          (post && form.get("back") && redirect(route, `${framePath}/device-type`)) ||
          (post && form.get("tablet") === "Android"
            ? redirect(route, `${framePath}/install`)
            : html(
                route,
                "What type of tablet are you adding?",
                `<form method="post"><h1>What type of tablet are you adding?</h1>
                ${choice("Tablet type", "tablet", ["iOS (iPad, iPod Touch)", "Android"])}</form>`,
              ))
        );
      case "install":
        return (
          chose("installed", `${framePath}/activate`, `${framePath}/tablet-type`) ??
          html(
            route,
            "Install Duo Mobile for Android",
            `<h1>Install Duo Mobile for Android</h1>
            <ol><li>Launch the Google Play Store app and search for "Duo Mobile".</li>
            <li>Tap "Install" to install the app.</li></ol>
            <form method="post">
              <button type="submit" name="back" value="1">Back</button>
              <button type="submit" name="installed" value="1">I have Duo Mobile installed</button>
            </form>`,
          )
        );
      case "activate": {
        if (post && form.get("back")) return redirect(route, `${framePath}/install`);
        // Each visit shows a new QR code, as Duo does.
        const code = randomBytes(10).toString("hex").toUpperCase();
        activations.push({ code, secret: randomBytes(16).toString("hex"), posts: 0 });
        return html(
          route,
          "Activate Duo Mobile for Android",
          `<h1>Activate Duo Mobile for Android</h1>
          <img class="qr" alt="QR code" width="346" height="346" src="/frame/qr?value=${activationValue(code)}" />
          <ol><li>Open Duo Mobile.</li><li>Select Use QR code</li><li>Scan this barcode.</li></ol>
          <p><a href="${framePath}/email-activation">Email me an activation link instead.</a></p>
          <form method="post">
            <button type="submit" name="back" value="1">Back</button>
            <button type="button" disabled>Continue</button>
          </form>`,
        );
      }
      case "email-activation": {
        const code = activations.at(-1)?.code;
        if (post && code && form.get("email")) {
          mail.push({
            to: form.get("email")!,
            body: `Activate Duo Mobile: https://m-${accountId}.duosecurity.com/android/${code}`,
          });
          return html(route, "Email sent", "<h1>Email sent</h1><p>Check your email.</p>");
        }
        return html(
          route,
          "Email activation link",
          `<h1>Email activation link</h1>
          <form method="post">
            <label>Email address <input name="email" type="email" autocomplete="off" /></label>
            <button type="submit">Send email</button>
          </form>`,
        );
      }
      default:
        return html(
          route,
          "My Settings & Devices",
          `<h1>My Settings &amp; Devices</h1>
          <ul id="devices">${devices
            .map(
              (device) =>
                `<li><h2>${escapeHtml(device)}</h2><button type="button">Device Options</button></li>`,
            )
            .join("")}</ul>
          <p>+ <a href="${framePath}/device-type">Add another device</a></p>`,
        );
    }
  }

  /** Duo's activation endpoint: one success per code, then its real "unknown code" error. */
  function respondActivation(route: Route, url: URL, form: URLSearchParams) {
    const request = route.request();
    posts.push({ url: url.href, fields: form, referer: request.headers().referer });
    const activation = activations.find(({ code }) => url.pathname.endsWith(`/${code}`));
    if (request.method() !== "POST" || !activation || activation.posts++ > 0)
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ code: 40403, message: "Unknown activation code", stat: "FAIL" }),
      });
    devices.push("Android tablet");
    usedWindows.clear();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        response: {
          akey: `DA${randomBytes(9).toString("hex").toUpperCase()}`,
          customer_name: "University of Toronto",
          // Real replies embed the school's logo and can pass 64 KB.
          customer_logo: randomBytes(66_000).toString("base64"),
          has_backup_restore: false,
          hotp_secret: activation.secret,
          use_totp: true,
          pkey: `DP${randomBytes(9).toString("hex").toUpperCase()}`,
          reactivation_token: randomBytes(16).toString("hex"),
          urg_secret: randomBytes(16).toString("hex"),
        },
        stat: "OK",
      }),
    });
  }

  return {
    routes: {
      [portalHost]: respondPortal,
      [signInHost]: respondSignIn,
      [duoHost]: respondDuo,
    },
    activations,
    devices,
    posts,
    mail,
    signOut() {
      signedIn = false;
      verified = false;
    },
  };
}
