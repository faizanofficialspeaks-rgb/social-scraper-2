#!/usr/bin/env python3
"""
Instagram session-based poster (instagrapi sidecar).

No Meta developer app / no Graph API review needed — posts using the account's
own web session (sessionid cookie pasted by the user, or username/password).

Commands:
  connect    --sessionid COOKIE [--username USER]   (cookie login, no password stored)
  connect    --username USER --password PASS        (password login)
  status     --username USER                         (check saved session, verify login)
  disconnect --username USER                         (forget saved session)
  publish    --username USER --media PATH --caption "..." [--type video|image] [--reel true|false]

All output is a single JSON object on stdout. Logs go to stderr.
"""

import argparse
import json
import os
import sys

# Point moviepy/imageio at the bundled ffmpeg binary (must run before any upload)
try:
    import imageio_ffmpeg
    os.environ.setdefault("IMAGEIO_FFMPEG_EXE", imageio_ffmpeg.get_ffmpeg_exe())
except Exception:
    pass

from instagrapi import Client
from instagrapi.exceptions import LoginRequired

SESSION_PREFIX = "ig_session_"


def emit(ok: bool, message: str, **extra) -> None:
    payload = {"ok": ok, "message": message, **extra}
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def session_path(username: str) -> str:
    safe = "".join(ch if ch.isalnum() else "_" for ch in username)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{SESSION_PREFIX}{safe}.json")


def make_client() -> Client:
    cl = Client()
    cl.request_timeout = 60
    cl.delay_range = [1, 3]
    return cl


def do_connect(args: argparse.Namespace) -> None:
    cl = make_client()
    try:
        if args.sessionid:
            cl.login_by_sessionid(args.sessionid)
            username = args.username or cl.account_info().username
            cl.dump_settings(session_path(username))
            emit(True, f"Connected with session cookie. Logged in as @{username}", username=username, method="session")
            return
        if args.username and args.password:
            cl.login(args.username, args.password)
            cl.dump_settings(session_path(args.username))
            emit(True, f"Connected. Logged in as @{args.username}", username=args.username, method="password")
            return
        emit(False, "Missing credentials: pass --username/--password or --sessionid")
    except Exception as exc:
        emit(False, f"Instagram login failed: {exc}")


def resume_session(cl: Client, username: str):
    """Load saved session and verify it's still valid — no password needed."""
    path = session_path(username)
    if not os.path.exists(path):
        return f"No saved session found for @{username}. Connect first."
    try:
        cl.load_settings(path)
        info = cl.account_info()  # verifies the restored session against IG
        cl.username = info.username
        return None, info
    except LoginRequired:
        return "Session expired — reconnect with a fresh sessionid cookie.", None
    except Exception as exc:
        return f"Session check failed: {exc}", None


def do_status(args: argparse.Namespace) -> None:
    cl = make_client()
    err, info = resume_session(cl, args.username)
    if err:
        emit(False, err)
        return
    emit(True, f"Session valid. Logged in as @{info.username}", username=info.username, full_name=info.full_name)


def do_disconnect(args: argparse.Namespace) -> None:
    path = session_path(args.username)
    if os.path.exists(path):
        os.remove(path)
        emit(True, "Session removed.")
    else:
        emit(False, "No saved session found.")


def do_publish(args: argparse.Namespace) -> None:
    username = args.username
    if not os.path.exists(args.media):
        emit(False, f"Media file not found: {args.media}")
        return

    cl = make_client()
    err, _info = resume_session(cl, username)
    if err:
        emit(False, err)
        return

    media_type = (args.type or "video").lower()
    caption = (args.caption or "").strip()
    try:
        if media_type == "image":
            result = cl.photo_upload(args.media, caption)
        elif args.reel and args.reel.lower() in ("true", "1", "yes"):
            result = cl.clip_upload(args.media, caption, extra_data={"share_to_fb": False})
        else:
            result = cl.video_upload(args.media, caption)
        emit(
            True,
            f"Published! https://www.instagram.com/p/{result.code}",
            postId=str(result.pk),
            code=result.code,
            url=f"https://www.instagram.com/p/{result.code}",
        )
    except Exception as exc:
        emit(False, f"Publish failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Instagram session-based poster")
    sub = parser.add_subparsers(dest="command", required=True)

    p_connect = sub.add_parser("connect")
    p_connect.add_argument("--username", default="")
    p_connect.add_argument("--password", default="")
    p_connect.add_argument("--sessionid", default="")

    p_status = sub.add_parser("status")
    p_status.add_argument("--username", required=True)

    p_disc = sub.add_parser("disconnect")
    p_disc.add_argument("--username", required=True)

    p_pub = sub.add_parser("publish")
    p_pub.add_argument("--username", required=True)
    p_pub.add_argument("--media", required=True)
    p_pub.add_argument("--caption", default="")
    p_pub.add_argument("--type", default="video")
    p_pub.add_argument("--reel", default="true")

    args = parser.parse_args()
    if args.command == "connect":
        do_connect(args)
    elif args.command == "status":
        do_status(args)
    elif args.command == "disconnect":
        do_disconnect(args)
    elif args.command == "publish":
        do_publish(args)


if __name__ == "__main__":
    main()