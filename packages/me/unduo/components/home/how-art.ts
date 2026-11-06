import { div, path, rect, svg, svgText } from "@-/me.unduo.lib.dom";

const ink = "#182230";
const muted = "#526174";
const line = "#cbd5e1";
const faint = "#e2e8f0";
const pale = "#f1f5f9";
const gray = "#94a3b8";
const accent = "#1e67cf";
const soft = "#e7f0ff";
const shadow = "#1e3a8a";
const white = "#fff";

/** A rounded rectangle, the shape every illustration is drawn with. */
function box(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  extra: Record<string, string> = {},
) {
  return rect({ x, y, width, height, rx: radius, fill, ...extra });
}

/**
 * A drawing of a QR code: three finder squares and seeded noise, 21 modules a
 * side. It encodes nothing, so a phone pointed at it finds nothing to open.
 */
function qrDrawing(seed: number, x: number, y: number, size: number, color: string) {
  const modules = 21;
  let state = seed;
  const random = () => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
  const finders = [
    [0, 0],
    [modules - 7, 0],
    [0, modules - 7],
  ] as const;
  let d = "";
  for (let row = 0; row < modules; row++)
    for (let column = 0; column < modules; column++) {
      const finder = finders.find(
        ([left, top]) =>
          column >= left - 1 && column <= left + 7 && row >= top - 1 && row <= top + 7,
      );
      // Rings around the finder's center: the outer square, a gap, the core, then a blank border.
      const ring =
        finder && Math.max(Math.abs(column - finder[0] - 3), Math.abs(row - finder[1] - 3));
      const on = finder ? ring === 3 || ring! <= 1 : random() < 0.5;
      if (on) d += `M${column} ${row}h1v1h-1z`;
    }
  return svg(
    { x, y, width: size, height: size, viewBox: `0 0 ${modules} ${modules}` },
    path({ d, fill: color, "shape-rendering": "crispEdges" }),
  );
}

/** An illustration's canvas: decorative, since the text beside it says the same. */
function canvas(...children: (Element | Element[])[]) {
  return svg({ class: "how-art", viewBox: "0 0 480 360", "aria-hidden": "true" }, children);
}

/** Step 1: a window of the school's Duo portal, showing the QR code it makes for Duo Mobile. */
export function portalArt() {
  return div(
    { class: "how-visual how-visual-portal" },
    canvas(
      box(56, 60, 368, 264, 20, shadow, { opacity: "0.08" }),
      box(56, 48, 368, 264, 20, white),
      box(78, 66, 10, 10, 5, "#f87171"),
      box(96, 66, 10, 10, 5, "#fbbf24"),
      box(114, 66, 10, 10, 5, "#34d399"),
      box(56, 92, 368, 1, 0, faint),
      box(84, 124, 128, 14, 7, ink),
      box(84, 154, 140, 8, 4, line),
      box(84, 170, 118, 8, 4, line),
      box(84, 186, 132, 8, 4, line),
      box(84, 222, 104, 32, 10, "#6db33f"),
      box(102, 234, 68, 8, 4, white),
      box(246, 114, 150, 150, 14, white, { stroke: faint, "stroke-width": "2" }),
      qrDrawing(17, 258, 126, 126, ink),
    ),
  );
}

/** Step 2: Duo's QR code becomes a standard 2FA QR code. */
export function convertArt() {
  const card = (x: number, seed: number, color: string, label: string) => [
    box(x, 94, 164, 196, 18, shadow, { opacity: "0.08" }),
    box(x, 82, 164, 196, 18, white),
    qrDrawing(seed, x + 20, 102, 124, color),
    svgText(
      {
        x: x + 82,
        y: 256,
        "text-anchor": "middle",
        "font-size": "14",
        "font-weight": "600",
        fill: muted,
      },
      label,
    ),
  ];
  return div(
    { class: "how-visual how-visual-convert" },
    canvas(
      card(32, 29, ink, "Duo QR code"),
      card(284, 61, accent, "2FA QR code"),
      box(212, 152, 56, 56, 28, accent),
      path({
        d: "M226 180h26m-9-9 9 9-9 9",
        fill: "none",
        stroke: white,
        "stroke-width": "3.5",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  );
}

/** Step 3: a phone's authenticator app, with a passcode for Duo. */
export function phoneArt() {
  const account = (y: number, fill: string, avatar: string, code: string, current: boolean) => [
    box(170, y, 140, 74, 14, fill),
    box(182, y + 12, 22, 22, 11, avatar),
    current
      ? svgText({ x: 212, y: y + 28, "font-size": "13", "font-weight": "600", fill: ink }, "Duo")
      : box(212, y + 15, 56, 7, 3.5, gray),
    box(212, y + (current ? 36 : 27), 44, 6, 3, line),
    svgText(
      {
        x: 182,
        y: y + 62,
        "font-size": current ? "24" : "20",
        "font-weight": "700",
        "letter-spacing": "1.5",
        fill: current ? accent : gray,
      },
      code,
    ),
  ];
  return div(
    { class: "how-visual how-visual-phone" },
    canvas(
      box(150, 32, 188, 372, 34, shadow, { opacity: "0.1" }),
      box(146, 20, 188, 372, 34, ink),
      box(156, 30, 168, 352, 26, white),
      box(212, 40, 56, 10, 5, ink),
      box(170, 66, 64, 10, 5, ink),
      account(92, soft, accent, "284 913", true),
      account(178, pale, gray, "105 772", false),
      account(264, pale, line, "630 418", false),
    ),
  );
}
