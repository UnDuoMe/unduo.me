# @-/me.unduo.configs.ai-replies

Asks ChatGPT, Gemini and Claude the home page's prompt about a setup file, the way a
student would, and saves a screenshot of each reply for the home page.

```sh
vp run capture:ai                          # all three, www/files/unduo saved as UofT's
vp run capture:ai --site claude            # one site; repeat --site for more
vp run capture:ai --focus                  # also set ChatGPT to Pro and use Claude's file picker
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
its last stop, Pro, whose menu opens only for a foreground click, and for a few
seconds to choose the file in Claude's file picker, so Claude shows its plain name.
**Anything you type meanwhile goes to Chrome**, so run it only when you're away from the
keyboard. The prompt check stops a stray key from being sent, but the key still reaches
the page. Gemini and Claude answer with whatever model is chosen, and the script records it.
The home page features each site's strongest model: ChatGPT Pro, Gemini 3.1 Pro (Advanced
reasoning) and Claude Fable 5.1 at High effort, so choose those two in Chrome first; they
stay chosen. Their menus open only for a foreground click too. Pro can think for twenty
minutes or more, so the script waits up to 45 minutes for a reply.

Once a reply has its verdict and reads the same twice, the script takes one screenshot of
the whole conversation, nothing joined: the attached file, the whole prompt and the whole
reply, down to its end, where the prompt's P.S. asks for the file's SHA-256. ChatGPT and
Claude fold a long prompt behind "Show more" and Gemini behind "Expand"; the script
unfolds it first, and stops if it stays folded. A window can't be taller than the screen,
so the script zooms the page out one of Chrome's steps at a time (90, 80, 75, 67, 50, 33
and 25%, as ⌘− does) until it fits. At each step it narrows the window so the page stays
880 CSS pixels wide, the width at which the sites keep their sidebars closed, down to
Chrome's narrowest window, 500 points. The page fits when a scroll from its top to its end
brings in nothing but blank space (`showsAll`), as a site's padding under the last message
does; text renders a little differently after a scroll, so screenshots are compared row by
row by their mean gray. The site's zoom goes back to 100% afterward, since Chrome keeps it
for the site's next visit, and a run that stopped partway is undone at the next run's start.
The script stops without a screenshot if scrolling never moved the page, since then it
can't tell whether the page fits, or if the page shows a list of the account's chats.

The screenshot leaves out only the browser's toolbar and the strips at the page's edges that
show the signed-in account: ChatGPT's and Gemini's rail of icons, with the account's picture
at its foot, and Gemini's line under the prompt box, which names the account's domain
(`account` in `sites.ts`, in CSS pixels). Chrome's bar across the page, such as "isn't your
default browser", is closed first. Each reply in `results.json` records the zoom, and
`hash`: the last SHA-256 in the reply or anywhere on the page under it, as in a code block,
and whether it matches the file's; the script warns when it doesn't. Gemini and Claude's
incognito chat can't run code, and say so instead of giving one.

## Output

- `apps/unduo-web/src/assets/ai-reply-<site>.webp`: each screenshot, as lossless WebP at
  most 1,400 pixels wide, which the home page shows under its hero. The build publishes them with the other
  assets, so run `vp run publish:assets` before pushing.
- `results.json`: the prompt, and per site when it ran, the file's name and SHA-256, the
  model, the verdict (`yes` or `no`) and the whole reply as Markdown, or why the site
  couldn't be asked. A run of some sites keeps the other sites' entries. `replyMarkdown()`
  rebuilds the reply from the accessibility tree: its paragraphs, headings and lists, a list
  item's lead such as "Where data can go:" in bold, and no buttons, such as a thinking
  summary or a cited file. The tree sums up some long paragraphs in one line cut short with
  "..."; then `whole` is false and the command says so. Copying the reply with the site's
  Copy button doesn't work from the background: a page without focus can't write to the
  clipboard.
- `.output/ai-replies/` at the repository root: `<site>-<zoom>-top.png` and
  `<site>-<zoom>-end.png`, the window at each zoom tried, scrolled to the top and to the end;
  `<site>-cropped.png`, the screenshot before WebP; and `<site>-tree.txt`, the tree the
  reply was read from.

The home page's cards show each whole reply and its model, from `aiReplies` in
`packages/me/unduo/components/home/ai-replies.ts`. Copy the replies there from
`results.json` whenever the screenshots change.

One site failing doesn't stop the others. The script exits with an error when a site fails
or a reply says "Safe: no", after saving every screenshot it could.

The script replaces the clipboard while it runs and puts its text back afterward; anything
else on it, such as an image, is lost. A site that changes its labels breaks the patterns in
`sites.ts`; the error names the pattern it waited for.
