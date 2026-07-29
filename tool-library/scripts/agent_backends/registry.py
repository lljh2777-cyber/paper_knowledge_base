"""Built-in CLI backend discovery."""

from __future__ import annotations

from .base import AgentCliBackend
from .claude_code import ClaudeCodeBackend
from .codex_cli import CodexCliBackend
from .opencode import OpenCodeBackend


_BACKENDS: dict[str, AgentCliBackend] = {
    "claude-code": ClaudeCodeBackend(),
    "codex-cli": CodexCliBackend(),
    "opencode": OpenCodeBackend(),
}


def get_backend(backend_id: str) -> AgentCliBackend:
    normalized = str(backend_id or "").strip().lower()
    try:
        return _BACKENDS[normalized]
    except KeyError as error:
        available = ", ".join(sorted(_BACKENDS))
        raise ValueError(
            f"Unknown CLI backend: {backend_id!r}. Available: {available}"
        ) from error


def list_backends() -> list[dict[str, object]]:
    return [
        _BACKENDS[backend_id].describe()
        for backend_id in sorted(_BACKENDS)
    ]
