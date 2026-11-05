import type { Route } from "@playwright/test";

const page = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Mock assistant</title>
<h1>Mock assistant (test fixture)</h1>
<p id="drop" style="padding: 2em; border: 1px dashed">Drop a file here</p>
<p id="attached" role="status"></p>
<textarea id="message" aria-label="Message" rows="6" cols="60"></textarea>
<button id="send" type="button">Send</button>
<p id="answer" role="log"></p>
<script>
  let file = "";
  const drop = document.getElementById("drop");
  drop.addEventListener("dragover", (event) => event.preventDefault());
  drop.addEventListener("drop", async (event) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    file = await dropped.text();
    document.getElementById("attached").textContent = "Attached " + dropped.name;
  });
  document.getElementById("send").addEventListener("click", async () => {
    const message = document.getElementById("message").value;
    const reply = await fetch("/conversation", {
      method: "POST",
      body: JSON.stringify({ file, message }),
    });
    document.getElementById("answer").textContent = await reply.text();
  });
</script>
</html>`;

/**
 * Stands in for an AI assistant. It keeps what it was given and gives a canned
 * answer, so it shows the student can do what the page says, not that the file
 * is safe: real assistants' answers are a separate check.
 */
export function mockAssistant() {
  const conversations: { file: string; message: string }[] = [];
  const respond = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fulfill({ contentType: "text/html", body: page });
    conversations.push(JSON.parse(request.postData() ?? "{}"));
    return route.fulfill({
      contentType: "text/plain",
      body: "Safe: yes. (Canned answer from the test's mock assistant.)",
    });
  };
  return { conversations, respond };
}
