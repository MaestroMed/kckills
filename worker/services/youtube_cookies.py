"""
youtube_cookies.py — Manage YouTube auth cookies for yt-dlp.

Why this exists : YouTube throttles unauthenticated yt-dlp requests
hard (429s, slow downloads, format restrictions). With a Premium
account session cookie, we get :
  * Far less throttling (Premium users get priority)
  * 1080p+ formats unlocked
  * Age-gate bypass
  * Better region access

How it's used : every yt-dlp subprocess in the worker (clipper,
vod_offset_finder, vod_hunter, channel_*) calls
`youtube_cookies.cli_args()` to get the right `--cookies <path>` flag
(empty list if no cookies configured). The cookies file is written
in Netscape format to a stable path that yt-dlp accepts directly.

Two source modes (env-controlled, falls back through the list) :

  1. KCKILLS_YT_COOKIES_FILE = path/to/cookies.txt
     User exported a Netscape-format cookies file (e.g. via the
     "Get cookies.txt LOCALLY" Chrome extension). Worker copies it
     verbatim. Easiest path — no Python deps, just one file.

  2. KCKILLS_YT_COOKIES_CHROME_PROFILE = "Profile 11"
     (or absolute path to a Chrome User Data\\Profile X dir)
     Reads the SQLite cookie DB from a Chrome profile that is NOT
     currently open in Chrome (active profiles are locked exclusive
     by Chromium). Decrypts the Windows-DPAPI-encrypted values via
     browser_cookie3. Re-extracts on each refresh() call.

If neither env var is set : returns no cookies args. yt-dlp falls
back to anonymous mode like before. Zero behaviour change.

The cookies file is stored at $WORKER_ROOT/.youtube_cookies.txt
(gitignored) — never commit, contains active session tokens.
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger()

WORKER_ROOT = Path(__file__).resolve().parent.parent
COOKIES_PATH = WORKER_ROOT / ".youtube_cookies.txt"

# Re-extract Chrome cookies if the cached file is older than this.
# Chrome cookies for YouTube auth typically last weeks but the
# refresh-cycle keeps short-lived ones (PSIDCC, __Secure-3PAPISID
# rotation tokens) in sync.
REFRESH_AFTER_SECONDS = 4 * 3600  # 4 hours


def cli_args() -> list[str]:
    """Return the yt-dlp CLI flag(s) for cookies, or empty list if
    cookies aren't configured.

    Idempotent : if the cached file is stale and we can refresh it,
    we do so silently. If refresh fails, we still return the flag
    pointing at the (stale) file — yt-dlp will try with old cookies
    rather than fall back to anon, since the old cookies are usually
    still valid for a while.
    """
    if not _ensure_fresh():
        return []
    if not COOKIES_PATH.exists():
        return []
    return ["--cookies", str(COOKIES_PATH)]


def status() -> dict:
    """For diagnostics — return what mode is configured + whether
    the cookies file is present + how old it is."""
    src_file = os.getenv("KCKILLS_YT_COOKIES_FILE", "").strip()
    src_profile = os.getenv("KCKILLS_YT_COOKIES_CHROME_PROFILE", "").strip()
    info: dict = {
        "mode": "none",
        "source": None,
        "file_exists": COOKIES_PATH.exists(),
        "file_age_s": int(time.time() - COOKIES_PATH.stat().st_mtime) if COOKIES_PATH.exists() else None,
    }
    if src_file:
        info["mode"] = "file"
        info["source"] = src_file
    elif src_profile:
        info["mode"] = "chrome_profile"
        info["source"] = src_profile
    return info


# ── Internals ──────────────────────────────────────────────────────

def _ensure_fresh() -> bool:
    """Make sure COOKIES_PATH is present and recent. Returns True if
    cookies are usable (file exists, regardless of age)."""
    src_file = os.getenv("KCKILLS_YT_COOKIES_FILE", "").strip()
    src_profile = os.getenv("KCKILLS_YT_COOKIES_CHROME_PROFILE", "").strip()

    # Nothing configured → no cookies (legacy behaviour).
    if not src_file and not src_profile:
        return False

    # File-mode : just copy if user-provided file is newer, or first time.
    if src_file:
        return _refresh_from_file(src_file)

    # Chrome profile mode.
    return _refresh_from_chrome_profile(src_profile)


def _refresh_from_file(src_path: str) -> bool:
    """Mirror an external Netscape cookies file into COOKIES_PATH.
    Cheap — just a copy if mtime changed."""
    src = Path(src_path)
    if not src.exists():
        log.warn("yt_cookies_file_missing", path=src_path)
        return False
    try:
        if (
            COOKIES_PATH.exists()
            and COOKIES_PATH.stat().st_mtime >= src.stat().st_mtime
        ):
            return True
        shutil.copy2(src, COOKIES_PATH)
        log.info("yt_cookies_refreshed_from_file", source=src_path)
        return True
    except Exception as e:
        log.warn("yt_cookies_file_refresh_failed", error=str(e)[:120])
        return COOKIES_PATH.exists()


def _refresh_from_chrome_profile(profile: str) -> bool:
    """Extract YouTube cookies from a Chrome profile that isn't
    currently active (active profile cookie DB is locked exclusive).
    Caches in COOKIES_PATH. Re-runs only if older than REFRESH_AFTER.
    """
    if (
        COOKIES_PATH.exists()
        and (time.time() - COOKIES_PATH.stat().st_mtime) < REFRESH_AFTER_SECONDS
    ):
        return True

    # Resolve profile path. Accept either a bare name like "Profile 11"
    # (relative to the default Chrome User Data dir) or an absolute path.
    if os.path.isabs(profile):
        profile_dir = Path(profile)
    else:
        chrome_root = Path(os.path.expandvars(
            r"%LOCALAPPDATA%\Google\Chrome\User Data"
        ))
        profile_dir = chrome_root / profile

    cookie_db = profile_dir / "Network" / "Cookies"
    if not cookie_db.exists():
        log.warn(
            "yt_cookies_chrome_profile_missing",
            profile=profile, expected_at=str(cookie_db),
        )
        return COOKIES_PATH.exists()  # fall back to old cookies if any

    # Use browser_cookie3 — it handles DPAPI decryption + the SQLite copy.
    # We point it at the specific cookie file via cookie_file= kwarg.
    try:
        import browser_cookie3
    except ImportError:
        log.warn("yt_cookies_browser_cookie3_missing")
        return COOKIES_PATH.exists()

    try:
        cj = browser_cookie3.chrome(
            cookie_file=str(cookie_db),
            domain_name=".youtube.com",
        )
        # Also pull google.com cookies — auth tokens live on google.com
        # (SID, HSID, SAPISID, etc.) and yt-dlp needs them.
        cj_google = browser_cookie3.chrome(
            cookie_file=str(cookie_db),
            domain_name=".google.com",
        )
        # Merge
        for c in cj_google:
            cj.set_cookie(c)
    except PermissionError:
        log.warn(
            "yt_cookies_chrome_profile_locked",
            profile=profile,
            hint="Open Chrome and SWITCH AWAY from this profile, then close its window",
        )
        return COOKIES_PATH.exists()
    except Exception as e:
        msg = str(e)
        if "Unable to get key" in msg or "decrypt" in msg.lower():
            # Chrome 127+ uses App-Bound Encryption (ABE) which blocks
            # external processes from reading the cookie decryption key.
            # browser_cookie3 doesn't support ABE yet (2026). The fix is
            # to use the cookies.txt file mode instead :
            #   1. Install "Get cookies.txt LOCALLY" Chrome extension
            #   2. Go to youtube.com (logged in)
            #   3. Click extension → Export → cookies.txt
            #   4. Set KCKILLS_YT_COOKIES_FILE=<path> in worker/.env
            log.warn(
                "yt_cookies_chrome_abe_blocked",
                hint="Chrome 127+ App-Bound Encryption blocks external decryption. "
                     "Use the cookies.txt extension instead — see worker/services/youtube_cookies.py docstring.",
            )
        else:
            log.warn("yt_cookies_chrome_extract_failed", error=msg[:200])
        return COOKIES_PATH.exists()

    # Write Netscape format
    try:
        _write_netscape(cj, COOKIES_PATH)
        n = sum(1 for _ in cj)
        log.info("yt_cookies_refreshed_from_chrome",
                 profile=profile, count=n)
        return True
    except Exception as e:
        log.warn("yt_cookies_write_failed", error=str(e)[:120])
        return COOKIES_PATH.exists()


def _write_netscape(cookiejar, path: Path) -> None:
    """Serialize a CookieJar to Netscape cookies.txt format
    (the format yt-dlp's --cookies expects).

    Format per line :
      domain<TAB>flag<TAB>path<TAB>secure<TAB>expiration<TAB>name<TAB>value
    """
    lines = [
        "# Netscape HTTP Cookie File",
        "# Generated by kckills worker — DO NOT COMMIT",
        "",
    ]
    for c in cookiejar:
        domain = c.domain
        flag = "TRUE" if domain.startswith(".") else "FALSE"
        path_ = c.path or "/"
        secure = "TRUE" if c.secure else "FALSE"
        expires = str(int(c.expires)) if c.expires else "0"
        name = c.name or ""
        value = c.value or ""
        # Skip non-text values (rare but happens for some httponly tokens)
        if "\t" in name or "\t" in value or "\n" in value:
            continue
        lines.append(
            f"{domain}\t{flag}\t{path_}\t{secure}\t{expires}\t{name}\t{value}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # Restrict perms — file contains active session tokens.
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


if __name__ == "__main__":
    # CLI : print status + force refresh.
    print("yt-dlp cookies status:")
    s = status()
    for k, v in s.items():
        print(f"  {k}: {v}")
    print()
    print("Forcing refresh...")
    args = cli_args()
    print(f"yt-dlp args: {args}")
    if COOKIES_PATH.exists():
        n_lines = sum(1 for _ in COOKIES_PATH.open() if not _.startswith("#"))
        print(f"  cookies.txt entries: {n_lines}")
