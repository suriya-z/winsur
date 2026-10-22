"""Winsur bridge plugin for Hermes Agent."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from urllib import request as urlrequest

HOOK_URL = "http://127.0.0.1:18900/hooks/event"


def _post_event(payload: dict) -> None:
    def _send():
        try:
            body = json.dumps(payload, default=str).encode("utf-8")
            req = urlrequest.Request(
                HOOK_URL,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlrequest.urlopen(req, timeout=2.5):
                pass
        except Exception:
            pass

    threading.Thread(target=_send, daemon=True).start()


def _cwd(kwargs: dict) -> str:
    c = kwargs.get("cwd")
    if c:
        return str(c)
    try:
        return str(Path.cwd())
    except Exception:
        return os.environ.get("USERPROFILE", "")


def _sid(kwargs: dict) -> str:
    return str(
        kwargs.get("session_id")
        or kwargs.get("parent_session_id")
        or "hermes-main"
    )


def register(ctx) -> None:
    def on_session_start(**kwargs):
        _post_event({
            "hook_event_name": "SessionStart",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def pre_llm_call(**kwargs):
        _post_event({
            "hook_event_name": "UserPromptSubmit",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def pre_tool_call(**kwargs):
        _post_event({
            "hook_event_name": "PreToolUse",
            "session_id": _sid(kwargs),
            "tool_name": kwargs.get("tool_name") or "tool",
            "tool_input": kwargs.get("args") if isinstance(kwargs.get("args"), dict) else {},
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def post_tool_call(**kwargs):
        _post_event({
            "hook_event_name": "PostToolUse",
            "session_id": _sid(kwargs),
            "tool_name": kwargs.get("tool_name") or "tool",
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def on_stream_end(**kwargs):
        _post_event({
            "hook_event_name": "Stop",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    def on_session_end(**kwargs):
        _post_event({
            "hook_event_name": "SessionEnd",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        })

    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("pre_llm_call", pre_llm_call)
    ctx.register_hook("pre_tool_call", pre_tool_call)
    ctx.register_hook("post_tool_call", post_tool_call)
    ctx.register_hook("on_stream_end", on_stream_end)
    ctx.register_hook("on_session_end", on_session_end)
