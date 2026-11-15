# Security policy

Hello, fellow student!

Firstly, NEVER enter your login details in ANY website outside of your official school login.

**Unduo won't ask for them.**

In fact, the way Unduo works is pretty straightforward:

1. Duo generates a proprietary 2FA QR code that only works with Duo (👎)
2. We convert this QR code into the standard format that all authenticator apps understand.
3. You scan our converted QR code with your favorite authenticator app.
4. You can now login to your school with Google Authenticator, Authy, or whatever you normally use! (🤗)

_The QR code Duo generates is sensitive._ That's why we designed Unduo to be a single, self-contained downloadable file that is fully auditable by anyone, including AI.

Don't take our word for it. Ask any AI to double-check:

1. Select your university from the dropdown.
2. Download the file, but **DO NOT RUN IT** (yet).
3. Drag and drop it into your favorite AI and copy this prompt: ...
4. Once your AI has given the thumbs up, double click the file and follow its further instructions.
5. Stay safe on the internet! **Never trust any website with your sensitive school data without a way to fully audit and verify it, even if they claim to be secure.**

## Reporting a vulnerability

Found something in unduo itself? Please don't post it in a public issue. Open a private security advisory (Security tab → "Report a vulnerability" on this repo), or email contact@unduo.me if you'd rather use email. Credit for the report is yours either way, and details stay private until a fix ships.

Two things people sometimes report are **not** unduo vulnerabilities: a school network that blocks jsDelivr, which makes setup fail closed instead, and a Duo admin who disables time-based passcodes, which makes unduo refuse to run. A device that was already compromised defeats any 2FA setup, ours included. unduo also can't protect the secret once you've scanned it into your authenticator app, so treat both QR codes in the setup flow like passwords and keep them off screenshots and screenshares.

## Checking that your download is the real build

Every push to main signs the site files automatically. On any machine with the GitHub CLI:

    gh attestation verify "UnDuo - YourSchool.html" --repo UnDuoMe/unduo.me

That command checks a Sigstore record saying these exact bytes were built by this repo's CI from a real commit. The setup page protects itself too: its plugin and styles are pinned to one jsDelivr commit (`05338f37e271de0e9ee3a258cee415b4fc5f4133`) with sha256 hashes inside the file, and the page refuses to start unless its own Content-Security-Policy is intact, so an edited copy fails on its own.

## What the setup file can reach

Two places, while setup runs: `cdn.jsdelivr.net` (styles, the setup plugin, screenshots, each hash-pinned) and your own school's `api-<id>.duosecurity.com` (the activation form). There are no accounts and no analytics. Nothing gets stored either: the TOTP secret lives in that tab's memory and disappears when you close the tab. Close the tab when you're done.
