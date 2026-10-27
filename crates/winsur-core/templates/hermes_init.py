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

    def _reply_text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, dict):
            for key in ("text", "content", "message", "response"):
                found = _reply_text(value.get(key))
                if found:
                    return found
            return ""
        if isinstance(value, (list, tuple)):
            parts = [_reply_text(item) for item in value]
            return "\n".join(part for part in parts if part).strip()
        return ""

    def on_stream_end(**kwargs):
        payload = {
            "hook_event_name": "Stop",
            "session_id": _sid(kwargs),
            "cwd": _cwd(kwargs),
            "agent_type": "hermes",
        }
        reply = ""
        for key in (
            "response",
            "text",
            "message",
            "content",
            "assistant_message",
            "final_response",
            "completion",
            "output",
        ):
            reply = _reply_text(kwargs.get(key))
            if reply:
                break
        if reply:
            payload["last_assistant_message"] = reply[:4000]
        _post_event(payload)

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
