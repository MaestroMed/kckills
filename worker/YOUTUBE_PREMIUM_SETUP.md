# YouTube Premium auth for yt-dlp — setup

## ⚠️ DON'T ENABLE THIS YET (April 2026)

YouTube enforces **PO Token** (Proof of Origin) for all authenticated
requests as of late 2025. yt-dlp can NOT generate PO tokens natively
— without one, authenticated requests get **storyboard-only** responses
(no real video formats). Anonymous yt-dlp gets full 1080p60 access.

So : **enabling cookies right now makes things WORSE**, not better.
Verified empirically on 2026-04-24 with yt-dlp 2026.04.10 + a fresh
Premium session :
  * `yt-dlp --list-formats <lec_vod>` (anonymous) → 1080p60, AV1, etc.
  * `yt-dlp --cookies <prem.txt> --list-formats <lec_vod>` → only sb0-sb3 storyboards.

The `worker/.env` ships with `KCKILLS_YT_COOKIES_FILE` **commented out**
for this reason. The `services/youtube_cookies.py` module is in place
ready to be re-enabled the moment a PO Token plugin lands :

  * `bgutil-ytdlp-pot-provider` — Node.js based, requires sidecar service
  * Pending native yt-dlp support (tracked in yt-dlp/yt-dlp issues)
  * Or a future Chrome version that exposes PO tokens via DPAPI

When that day comes, just uncomment the env var line, restart the
worker, and the auth path activates. Until then, anonymous mode is
the right call.

---

## Original setup guide (kept for when PO Token is solved)

The worker can authenticate yt-dlp with your YouTube Premium session
to drop 429 throttling, unlock 1080p+ formats, and bypass age-gates.
Setup takes ~30 seconds.

## Why not `--cookies-from-browser` directly?

Chrome 127+ ships with **App-Bound Encryption (ABE)** that blocks
external processes (yt-dlp, browser_cookie3, anything except Chrome
itself) from reading the cookie decryption key. So
`--cookies-from-browser chrome` fails with `Failed to decrypt with
DPAPI`. The Chrome team did this on purpose — fixes the hijack vector
where malware could grab your session by reading the cookie SQLite.

Workaround : have Chrome export the cookies via an extension that runs
**inside** Chrome (so it has access to the decrypted cookies through
the official `chrome.cookies` API). Then point yt-dlp at the exported
file.

## Setup (30 seconds)

### 1. Install the extension

Open Chrome → install **"Get cookies.txt LOCALLY"** :
https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc

(Why this one specifically : it runs purely client-side, doesn't phone
home, and has been audited by the community. Avoid sketchy clones.)

### 2. Export YouTube cookies

1. Go to https://www.youtube.com (make sure you're signed in with your
   Premium account)
2. Click the extension icon in the toolbar
3. Click **Export As → Netscape**
4. Save the file as `youtube_cookies.txt` somewhere stable, e.g. :
   `C:\Users\Matter1\Karmine_Stats\worker\youtube_cookies.txt`

### 3. Tell the worker about it

Add this line to `worker/.env` :

```
KCKILLS_YT_COOKIES_FILE=C:\Users\Matter1\Karmine_Stats\worker\youtube_cookies.txt
```

(Use the absolute path of wherever you saved the file in step 2.)

### 4. Restart the worker

```
taskkill /IM python.exe /F
cd worker
start_orchestrator.bat
```

Or just kill all `orchestrator.py` Python processes and re-launch via
the .bat — they'll auto-restart.

## Verify

```
cd worker
.venv\Scripts\python.exe -m services.youtube_cookies
```

Expected output :
```
yt-dlp cookies status:
  mode: file
  source: C:\Users\Matter1\Karmine_Stats\worker\youtube_cookies.txt
  file_exists: True
  file_age_s: 12

Forcing refresh...
yt-dlp args: ['--cookies', '...\.youtube_cookies.txt']
  cookies.txt entries: 23
```

Then test a real download :
```
.venv\Scripts\python.exe -m yt_dlp --cookies .youtube_cookies.txt --simulate --print "%(format)s|%(title)s" "https://youtu.be/<any LEC vod>"
```

If the Premium-tier formats appear (1080p+, AV1) without `Sign in to
confirm your age` errors, you're authenticated.

## Refresh

Cookies last several weeks. Re-export via the extension when you start
seeing `429` errors again. The worker's `youtube_cookies` helper
automatically picks up the new file mtime.

## Don't commit

`worker/.youtube_cookies.txt` is in `.gitignore`. The original file
you save (`youtube_cookies.txt` in step 2) should also be excluded
from any backup that goes to the cloud — the file contains your
active session tokens, anyone with it can impersonate you on YouTube.
