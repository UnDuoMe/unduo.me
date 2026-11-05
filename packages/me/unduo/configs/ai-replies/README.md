# @-/me.unduo.configs.ai-replies

Asks ChatGPT, Gemini and Claude the home page's prompt about a setup file, the way a
student would, and saves a screenshot of each reply for the home page.

```sh
vp run capture:ai                          # all three, the UofT file in www/files/020599
vp run capture:ai -- --site claude         # one site; repeat --site for more
vp run capture:ai -- --focus               # also set ChatGPT's model and use Claude's file picker
```

It drives your own Chrome, signed in to the three sites, through `orca computer`, in a
window of its own. Each site gets a new chat it doesn't keep: ChatGPT's temporary chat
(which is also unpersonalized), Gemini's temporary chat and Claude's incognito chat. The
file is pasted in as an attachment, as a file copied in Finder pastes, and the prompt
(`aiPrompt` from `@-/me.unduo.components.home/server`) is pasted from the clipboard into
the emptied prompt box. Nothing is sent unless the box then holds exactly the prompt.

By default everything runs in the background: the window stays behind the app you're
using and the pointer doesn't move. Chrome comes forward on its own for a moment when it
opens the window, and the app you were using goes back in front as soon as the window
appears. ChatGPT keeps the model chosen last, recorded as not checked, and Claude names a
pasted file with a timestamp in front (`1793919068903_University of Toronto.html`).

`--focus` brings Chrome to the front twice: for a moment to set ChatGPT's model slider to
its first stop, Instant, whose menu opens only for a foreground click, and for a few
seconds to choose the file in Claude's file picker, so Claude shows its plain name.
**Anything you type meanwhile goes to Chrome**, so run it only when you're away from the
keyboard. The prompt check stops a stray key from being sent, but the key still reaches
the page. Gemini and Claude answer with whatever model is chosen, and the script records it.

Once a reply has its verdict and reads the same twice, the script scrolls the chat to the
top, so the screenshot shows the attached file and the prompt above the reply. Gemini folds
a long prompt to its first sentence, and the screenshot shows it that way. The crop drops
the browser's toolbar, ChatGPT's sidebar, and each site's prompt box, ending at the lowest
gap between paragraphs above it.

## Output

- `apps/unduo-web/src/assets/ai-reply-<site>.webp`: each cropped screenshot, 1,400 pixels
  wide, which the home page shows under its hero. The build publishes them with the other
  assets, so run `vp run publish:assets` before pushing.
- `results.json`: the prompt, and per site when it ran, the file's name and SHA-256, the
  model, the verdict (`yes` or `no`) and the reply's text as the accessibility tree reads it
  (long paragraphs come truncated), or why the site couldn't be asked. A run of some sites
  keeps the other sites' entries.
- `.output/ai-replies/<site>.png` and `<site>-cropped.png` at the repository root: the
  window, uncropped and cropped.

The home page's cards quote a sentence of each reply, from `aiReplies` in
`packages/me/unduo/components/home/ai-replies.ts`, with each model and date. Update them
when a new screenshot shows a different reply.

One site failing doesn't stop the others. The script exits with an error when a site fails
or a reply says "Safe: no", after saving every screenshot it could.

The script replaces the clipboard while it runs and puts its text back afterward; anything
else on it, such as an image, is lost. A site that changes its labels breaks the patterns in
`sites.ts`; the error names the pattern it waited for.
