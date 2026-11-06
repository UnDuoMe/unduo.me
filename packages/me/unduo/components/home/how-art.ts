import { div, g, path, rect, svg, svgText } from "@-/me.unduo.lib.dom";

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

/** The AIs the Verify step's tabs name; `other` stands for any other. */
export type AiChoice = "chatgpt" | "claude" | "gemini" | "other";

/** Roughly how each AI's start page looks: its background, greeting and message box. */
const chatLooks: Record<
  AiChoice,
  {
    page: string;
    greeting: string;
    greetingFill: string;
    greetingSize: string;
    serif: boolean;
    box: string;
    boxStroke: string;
    placeholder: string;
    send: string;
  }
> = {
  chatgpt: {
    page: white,
    greeting: "What can I help with?",
    greetingFill: "#0d0d0d",
    greetingSize: "15",
    serif: false,
    box: white,
    boxStroke: "#e3e3e3",
    placeholder: "Ask anything",
    send: "#0d0d0d",
  },
  claude: {
    page: "#f5f4ee",
    greeting: "How can I help you today?",
    greetingFill: "#3d3929",
    greetingSize: "15",
    serif: true,
    box: white,
    boxStroke: "#e5e2d6",
    placeholder: "Message Claude",
    send: "#c6613f",
  },
  gemini: {
    page: white,
    greeting: "Hello there",
    greetingFill: "#4c7bea",
    greetingSize: "19",
    serif: false,
    box: "#f0f4f9",
    boxStroke: "#f0f4f9",
    placeholder: "Ask Gemini",
    send: "#5f6368",
  },
  other: {
    page: "#f8fafc",
    greeting: "",
    greetingFill: ink,
    greetingSize: "15",
    serif: false,
    box: white,
    boxStroke: line,
    placeholder: "Message your AI",
    send: ink,
  },
};

/**
 * The Verify step's drawing: a browser with its Downloads panel open over
 * `ai`'s start page, and `file` dragged from the panel into the message box.
 * Unless motion is reduced, the file moves along the dashed path and drops in.
 */
export function dragArt(file: string, ai: AiChoice) {
  const look = chatLooks[ai];
  const name = file.length > 26 ? `${file.slice(0, 20)}…${file.slice(-5)}` : file;
  const fileIcon = (x: number, y: number, width: number, height: number) => [
    box(x, y, width, height, 2, white, { stroke: gray, "stroke-width": "1.2" }),
    box(x + 2, y + height / 2 - 1, width - 4, 3, 1, accent),
  ];
  const label = (x: number, y: number, size = "9.5") =>
    svgText({ x, y, "font-size": size, "font-weight": "500", fill: ink }, name);
  const round = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };
  return div(
    { class: "verify-visual" },
    svg(
      { class: "verify-art", viewBox: "0 0 360 280", "aria-hidden": "true" },
      box(10, 22, 340, 252, 14, shadow, { opacity: "0.1" }),
      box(10, 14, 340, 252, 14, look.page, { stroke: "#dbe3ed" }),
      // The browser's toolbar, its Downloads button highlighted.
      box(10, 14, 340, 40, 14, pale),
      box(10, 40, 340, 14, 0, pale),
      box(10, 54, 340, 1, 0, faint),
      box(24, 30, 9, 9, 4.5, "#f87171"),
      box(38, 30, 9, 9, 4.5, "#fbbf24"),
      box(52, 30, 9, 9, 4.5, "#34d399"),
      box(74, 25, 170, 18, 9, white),
      box(258, 28, 12, 12, 3, line),
      box(280, 24, 26, 20, 6, "#dbe7fb"),
      path({
        d: "M293 28v8m-4-3.5 4 4 4-4M287.5 40h11",
        stroke: accent,
        "stroke-width": "1.8",
        ...round,
      }),
      box(318, 28, 12, 12, 3, line),
      // The AI's start page: a greeting over its message box.
      look.greeting
        ? svgText(
            {
              x: 180,
              y: 146,
              "text-anchor": "middle",
              "font-size": look.greetingSize,
              "font-weight": look.serif ? "400" : "500",
              "font-family": look.serif ? "Georgia, 'Times New Roman', serif" : "inherit",
              fill: look.greetingFill,
            },
            look.greeting,
          )
        : box(120, 136, 120, 12, 6, faint),
      box(30, 170, 300, 70, 18, look.box, { stroke: look.boxStroke, "stroke-width": "1.5" }),
      svgText({ x: 48, y: 228, "font-size": "11", fill: "#8f8f8f" }, look.placeholder),
      box(298, 210, 24, 24, ai === "claude" ? 7 : 12, look.send),
      path({
        d: "M310 228v-11m-4.5 4.5 4.5-4.5 4.5 4.5",
        stroke: white,
        "stroke-width": "1.8",
        ...round,
      }),
      box(24, 164, 312, 82, 22, "none", {
        stroke: accent,
        "stroke-width": "1.5",
        "stroke-dasharray": "6 5",
      }),
      g(
        { class: "drop-file" },
        box(44, 178, 184, 22, 7, soft),
        fileIcon(51, 182, 10, 14),
        label(67, 193, "9"),
      ),
      // The Downloads panel, with the file to drag.
      box(134, 58, 202, 66, 10, shadow, { opacity: "0.12" }),
      box(134, 52, 202, 66, 10, white, { stroke: faint, "stroke-width": "1.5" }),
      svgText({ x: 148, y: 71, "font-size": "11", "font-weight": "600", fill: ink }, "Downloads"),
      box(142, 80, 186, 30, 7, soft),
      fileIcon(150, 86, 13, 17),
      label(170, 99),
      // Where the file goes, and the file on its way under the pointer.
      path({
        d: "M206 120C200 142 152 148 134 164",
        stroke: accent,
        "stroke-width": "1.8",
        "stroke-dasharray": "4 4",
        ...round,
      }),
      path({
        d: "M141.8 162.4L134 164L136.5 156.4",
        stroke: accent,
        "stroke-width": "1.8",
        ...round,
      }),
      g(
        { class: "drag-file" },
        box(2, 4, 184, 26, 8, shadow, { opacity: "0.12" }),
        box(0, 0, 184, 26, 8, white, { stroke: accent, "stroke-width": "1.5" }),
        fileIcon(8, 5, 11, 15),
        label(26, 17),
        path({
          d: "M166 12v17l4.6-4.2 3.4 7.6 3.1-1.4-3.4-7.4 6.2-.2z",
          fill: ink,
          stroke: white,
          "stroke-width": "1",
          "stroke-linejoin": "round",
        }),
      ),
    ),
  );
}
