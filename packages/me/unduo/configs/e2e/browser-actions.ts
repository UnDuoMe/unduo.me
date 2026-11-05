import { jsQR } from "@-/com.npmjs.jsqr";
import type { BrowserContext, Locator, Page } from "@playwright/test";

/**
 * What a person does that a browser test can't do with a click: a browser's own
 * context menu, a drag from the desktop, a phone's camera, a look at the clipboard.
 */

/** Stands in for the context menu's Copy Image: the picture on screen, as an image. */
export async function copyImage(image: Locator) {
  const png = (await image.screenshot()).toString("base64");
  await image.page().bringToFront();
  await image.page().evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, png);
}

/** Puts text on the clipboard, as copying an address or a link does. */
export async function copyText(page: Page, text: string) {
  await page.bringToFront();
  await page.evaluate((copied) => navigator.clipboard.writeText(copied), text);
}

/** What's on the clipboard, read by pasting into a scratch page as a person would. */
export async function pastedText(context: BrowserContext) {
  const scratch = await context.newPage();
  await scratch.setContent('<textarea id="scratch" aria-label="Notes"></textarea>');
  await scratch.locator("#scratch").click();
  await scratch.keyboard.press("ControlOrMeta+V");
  const text = await scratch.locator("#scratch").inputValue();
  await scratch.close();
  return text;
}

/** Drops files from the desktop on an element, with the same events a browser sends. */
export async function dropFile(target: Locator, name: string, type: string, bytes: Buffer) {
  const dataTransfer = await target.page().evaluateHandle(
    ({ name, type, data }) => {
      const transfer = new DataTransfer();
      const content = Uint8Array.from(atob(data), (letter) => letter.charCodeAt(0));
      transfer.items.add(new File([content], name, { type }));
      return transfer;
    },
    { name, type, data: bytes.toString("base64") },
  );
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

/** A phone's camera: reads the QR code in the pixels on screen, not the element's source. */
export async function scanQrCode(code: Locator) {
  const png = (await code.screenshot()).toString("base64");
  const context = code.page().context();
  const decoder = await context.newPage();
  const { width, height, pixels } = await decoder.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${data}`)).blob(),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const drawing = canvas.getContext("2d")!;
    drawing.drawImage(bitmap, 0, 0);
    const { data: rgba, width, height } = drawing.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width, height, pixels: Array.from(rgba) };
  }, png);
  await decoder.close();
  const read = jsQR(Uint8ClampedArray.from(pixels), width, height);
  if (!read) throw new Error("The camera found no QR code on screen");
  return read.data;
}
