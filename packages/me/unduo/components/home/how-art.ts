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

/** What a drawing is made of: shapes, and lists of shapes, nested as deep as they come. */
type Drawing = Element | Drawing[];

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
function canvas(...children: Drawing[]) {
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

/** A file name short enough for the drawings, keeping its start and `.html`. */
const shortName = (file: string) =>
  file.length > 36 ? `${file.slice(0, 30)}…${file.slice(-5)}` : file;

const round = { fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" };

/** A document with an accent stripe. */
const fileIcon = (x: number, y: number, width: number, height: number) => [
  box(x, y, width, height, 2, white, { stroke: gray, "stroke-width": "1.2" }),
  box(x + 2, y + height / 2 - 1, width - 4, 3, 1, accent),
];

/** A file's name, beside its icon. */
const fileLabel = (name: string, x: number, y: number) =>
  svgText({ x, y, "font-size": "9", "font-weight": "500", fill: ink }, name);

/** The pointer, its tip at `x`, `y`. */
const pointer = (x: number, y: number) =>
  path({
    d: `M${x} ${y}v17l4.6-4.2 3.4 7.6 3.1-1.4-3.4-7.4 6.2-.2z`,
    fill: ink,
    stroke: white,
    "stroke-width": "1",
    "stroke-linejoin": "round",
  });

/** A dialog's drawing: decorative, since the text beside it says the same. */
const dialogCanvas = (...children: Drawing[]) =>
  div(
    { class: "dialog-visual" },
    svg({ class: "dialog-art", viewBox: "0 0 360 280", "aria-hidden": "true" }, children),
  );

/** A browser window over a page of color `page`, its Downloads button highlighted. */
function browserWindow(page: string) {
  return [
    box(10, 22, 340, 252, 14, shadow, { opacity: "0.1" }),
    box(10, 14, 340, 252, 14, page, { stroke: "#dbe3ed" }),
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
  ];
}

/** The browser's Downloads panel, under its button, with the file in its list. */
function downloadsPanel(name: string) {
  return [
    box(118, 58, 218, 66, 10, shadow, { opacity: "0.12" }),
    box(118, 52, 218, 66, 10, white, { stroke: faint, "stroke-width": "1.5" }),
    svgText({ x: 132, y: 71, "font-size": "11", "font-weight": "600", fill: ink }, "Downloads"),
    box(126, 80, 202, 30, 7, soft),
    fileIcon(134, 86, 13, 17),
    fileLabel(name, 154, 99),
  ];
}

/**
 * The Download step's drawing: a click on the page's download link, and the
 * browser's Downloads panel popping up under its button with the file. Unless
 * motion is reduced, the panel pops up again and again.
 */
export function downloadArt(file: string) {
  return dialogCanvas(
    browserWindow("#f8fafc"),
    // unduo.me's dialog, its underlined download link under the pointer.
    box(36, 132, 200, 116, 12, shadow, { opacity: "0.08" }),
    box(36, 126, 200, 116, 12, white, { stroke: faint, "stroke-width": "1.5" }),
    box(52, 144, 90, 8, 4, gray),
    box(52, 160, 120, 10, 5, ink),
    box(52, 194, 92, 9, 4.5, accent),
    box(52, 207, 92, 2, 1, accent),
    box(150, 194, 50, 9, 4.5, gray),
    box(52, 222, 130, 7, 3.5, line),
    pointer(118, 199),
    // Where the file shows up.
    path({
      d: "M206 196C232 186 244 160 238 128",
      stroke: accent,
      "stroke-width": "1.8",
      "stroke-dasharray": "4 4",
      ...round,
    }),
    path({
      d: "M235.3 135.5L238 128L243.2 134.1",
      stroke: accent,
      "stroke-width": "1.8",
      ...round,
    }),
    g(
      { class: "download-ring" },
      box(275, 19, 36, 30, 9, "none", { stroke: accent, "stroke-width": "2" }),
    ),
    g({ class: "download-pop" }, downloadsPanel(shortName(file))),
  );
}

/**
 * The Copy prompt step's drawing: a click on the copy button under the prompt,
 * and the prompt on a clipboard, checked. Unless motion is reduced, the
 * clipboard fills and empties again and again.
 */
export function copyArt() {
  return dialogCanvas(
    // unduo.me's dialog: the prompt, and the copy button under the pointer.
    box(24, 48, 220, 200, 14, shadow, { opacity: "0.08" }),
    box(24, 40, 220, 200, 14, white, { stroke: faint, "stroke-width": "1.5" }),
    box(40, 58, 80, 7, 3.5, gray),
    box(40, 74, 188, 96, 8, pale, { stroke: faint, "stroke-width": "1.5" }),
    box(52, 88, 160, 5, 2.5, line),
    box(52, 100, 150, 5, 2.5, line),
    box(52, 112, 164, 5, 2.5, line),
    box(52, 124, 120, 5, 2.5, line),
    box(52, 140, 156, 5, 2.5, line),
    box(52, 152, 100, 5, 2.5, line),
    box(40, 184, 150, 30, 8, accent),
    box(50, 191, 10, 15, 2, "none", { stroke: white, "stroke-width": "1.4" }),
    box(52.5, 189, 5, 4, 1.5, white),
    box(66, 196, 110, 6, 3, white),
    pointer(150, 196),
    // Where the prompt goes: the clipboard.
    path({
      d: "M194 196C214 196 230 186 246 176",
      stroke: accent,
      "stroke-width": "1.8",
      "stroke-dasharray": "4 4",
      ...round,
    }),
    path({ d: "M238 176.3L246 176L242.3 183.1", stroke: accent, "stroke-width": "1.8", ...round }),
    box(252, 104, 92, 130, 12, shadow, { opacity: "0.1" }),
    box(248, 96, 92, 130, 12, white, { stroke: line, "stroke-width": "1.5" }),
    box(274, 86, 40, 20, 6, gray),
    g(
      { class: "copy-paper" },
      box(262, 124, 64, 5, 2.5, line),
      box(262, 136, 56, 5, 2.5, line),
      box(262, 148, 62, 5, 2.5, line),
      box(262, 160, 44, 5, 2.5, line),
      box(303, 197, 28, 28, 14, "#16a34a"),
      path({ d: "M311 211l4.5 4.5 8-9", stroke: white, "stroke-width": "2.2", ...round }),
    ),
  );
}

/**
 * The Verify step's drawing: a browser with its Downloads panel open over
 * `ai`'s start page, and `file` dragged from the panel into the message box.
 * Unless motion is reduced, the file moves along the dashed path and drops in.
 */
export function dragArt(file: string, ai: AiChoice) {
  const look = chatLooks[ai];
  const name = shortName(file);
  return dialogCanvas(
    browserWindow(look.page),
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
      box(44, 178, 206, 22, 7, soft),
      fileIcon(51, 182, 10, 14),
      fileLabel(name, 67, 193),
    ),
    downloadsPanel(name),
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
      box(2, 4, 206, 26, 8, shadow, { opacity: "0.12" }),
      box(0, 0, 206, 26, 8, white, { stroke: accent, "stroke-width": "1.5" }),
      fileIcon(8, 5, 11, 15),
      fileLabel(name, 26, 17),
      pointer(190, 12),
    ),
  );
}

/**
 * The Continue step's drawing: a double click on the file in the Downloads
 * panel, which opens it in a new window at its first step. Unless motion is
 * reduced, the clicks ripple and the window opens again and again.
 */
export function openArt(file: string) {
  return dialogCanvas(
    browserWindow("#f8fafc"),
    box(30, 78, 70, 8, 4, faint),
    box(30, 94, 52, 8, 4, faint),
    downloadsPanel(shortName(file)),
    g(
      { class: "click-ring" },
      box(229, 85, 26, 26, 13, "none", { stroke: accent, "stroke-width": "2" }),
    ),
    g(
      { class: "click-ring click-ring-second" },
      box(223, 79, 38, 38, 19, "none", { stroke: accent, "stroke-width": "1.5" }),
    ),
    pointer(242, 96),
    // The file, open in a window of its own at its first step.
    g(
      { class: "open-window" },
      box(30, 136, 208, 134, 12, shadow, { opacity: "0.14" }),
      box(26, 128, 208, 134, 12, white, { stroke: "#dbe3ed", "stroke-width": "1.5" }),
      box(26, 128, 208, 20, 12, pale),
      box(26, 140, 208, 8, 0, pale),
      box(36, 135, 7, 7, 3.5, "#f87171"),
      box(47, 135, 7, 7, 3.5, "#fbbf24"),
      box(58, 135, 7, 7, 3.5, "#34d399"),
      svgText({ x: 42, y: 168, "font-size": "12", "font-weight": "700", fill: accent }, "unduo."),
      box(46, 181, 96, 1.5, 0.75, line),
      box(41, 177, 10, 10, 5, accent),
      box(65, 177, 10, 10, 5, line),
      box(89, 177, 10, 10, 5, line),
      box(113, 177, 10, 10, 5, line),
      box(137, 177, 10, 10, 5, line),
      box(42, 196, 176, 56, 8, white, { stroke: faint, "stroke-width": "1.5" }),
      box(54, 207, 104, 8, 4, ink),
      box(54, 221, 140, 5, 2.5, line),
      box(54, 233, 88, 12, 4, accent),
    ),
  );
}
