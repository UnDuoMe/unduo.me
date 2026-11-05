# @-/me.unduo.configs.git

Repository Git identity and Vite+ hook policy. The only allowed author and
committer is `cursoragent <199161495+cursoragent@users.noreply.github.com>`.
The same identity is used for reproducible CDN asset commits.
All `Co-authored-by` trailers are forbidden, including automatic agent attribution.
Keep copyright and project metadata under UnDuoMe, without personal credit.

`vp install` runs `vp config` and `vp run setup:git`: it installs the Vite+
dispatcher and sets the repository-local name/email, requires a configured
identity, and disables inherited personal signing for commits and tags.
Global Git configuration is untouched. Run `vp hooks status` to inspect hooks.

Pushes authenticate as the private, organization-owned **UnDuoMe Automation**
GitHub App (`unduome-automation[bot]`). Run these once on this Mac:

```sh
vp run setup:github-app
vp run check:github-app
```

The setup command starts a loopback-only approval page. Follow its link, create
the App under UnDuoMe, then install it with **Only select repositories → unduo.me**.
It requests Contents and Workflows write access, Actions read access and implicit
Metadata read access. Webhooks and user OAuth are disabled. GitHub requires
browser approval for registration and installation; see the
[manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest).
If interrupted after creating the App, run setup again and use **finish setup**
on the local page after completing installation.

The private key stays in `~/.config/unduo/github-app.json` with mode `0600`,
outside the worktree. `XDG_CONFIG_HOME` or `UNDUO_GITHUB_APP_CONFIG` can override
that location, but a path inside this repository is rejected. Installation tokens
are minted as needed, restricted to this repository and never saved or printed
to the terminal. The credential helper sends them directly to Git.

Local setup resets inherited GitHub credential helpers and extra HTTP headers
for this repository, so an absent or expired App setup cannot fall back to the
personal Keychain login. Other repositories and global Git credentials are
unchanged. Use the HTTPS origin URL without credentials in it. Git operations
on this private repo need App approval to be completed first.

- `pre-commit` checks the effective author and committer before `vp staged`.
- `prepare-commit-msg` checks identities and supplied messages even when
  `git commit --no-verify` is used.
- `commit-msg` checks identities and rejects all `Co-authored-by` trailers,
  including any added in the editor.
- `pre-push` checks the entire ancestry of every branch or tag being pushed,
  including first pushes, force pushes, merges and annotated tags. Deletions
  have no commits to check. Mailmaps and replacement refs cannot hide identities;
  shallow history is rejected because its missing ancestors cannot be checked.
  Coauthor trailers in existing history are rejected as well.
  It then verifies installation-token authentication; SSH URLs, inline
  credentials and extra Authorization headers are rejected. In CI, checkout's
  GitHub App token is allowed only when the workflow actor is
  `unduome-automation[bot]`.

Run `vp run check:git` before pushing to audit every local ref. CI also audits
full history. Hook checks can be bypassed by disabling hooks or using Git
plumbing, so they are guardrails rather than authentication or a server-side
permission boundary. The GitHub account used to authenticate a push is separate
from commit attribution. The local Cursor CLI's
[attribution setting](https://cursor.com/docs/cli/reference/configuration) adds
a commit trailer; it does not supply a separate cursoragent GitHub login.
Signed tags also carry their own tagger identity.
