"""CLI agent backend protocol and built-in adapters."""

from .base import (
    BACKEND_PROTOCOL_VERSION,
    AccessMode,
    AgentCliBackend,
    BackendAccessPolicy,
    BackendCapabilities,
    BackendCommandRequest,
    ParsedBackendEvent,
    WriteScope,
)
from .access_policy import build_action_access_policy
from .registry import get_backend, list_backends

__all__ = [
    "BACKEND_PROTOCOL_VERSION",
    "AccessMode",
    "AgentCliBackend",
    "BackendAccessPolicy",
    "BackendCapabilities",
    "BackendCommandRequest",
    "ParsedBackendEvent",
    "WriteScope",
    "build_action_access_policy",
    "get_backend",
    "list_backends",
]
