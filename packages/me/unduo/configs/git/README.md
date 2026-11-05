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

Run `vp run check:git` before pushing to audit every local ref. CI also audits
full history. Hook checks can be bypassed by disabling hooks or using Git
plumbing, so they are guardrails rather than authentication or a server-side
permission boundary. The GitHub account used to authenticate a push is separate
from commit attribution; use separate bot or GitHub App credentials to avoid a
personal pusher appearing in GitHub activity. The local Cursor CLI's
[attribution setting](https://cursor.com/docs/cli/reference/configuration) adds
a commit trailer; it does not supply a separate cursoragent GitHub login.
Signed tags also carry their own tagger identity.
