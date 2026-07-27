"""Stable protocol shared by Dashboard CLI agent adapters."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol


BACKEND_PROTOCOL_VERSION = "1.0"
AccessMode = Literal["read-only", "workspace-write"]
WriteScope = Literal["none", "restricted", "stage-owned", "full"]


@dataclass(frozen=True)
class BackendAccessPolicy:
    """Host-owned permission boundary for one backend invocation."""

    mode: AccessMode
    write_scope: WriteScope
    allowed_roots: tuple[Path, ...]
    denied_roots: tuple[Path, ...] = ()
    denied_tools: tuple[str, ...] = ()
    post_validators: tuple[str, ...] = ()
    require_change_manifest: bool = False
    rollback_on_failure: bool = False

    def __post_init__(self) -> None:
        if self.mode == "read-only" and self.write_scope != "none":
            raise ValueError("read-only access must use write_scope='none'")
        if self.mode == "workspace-write" and self.write_scope == "none":
            raise ValueError("workspace-write access requires a write scope")
        if not self.allowed_roots:
            raise ValueError("access policy requires at least one allowed root")

    def to_payload(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "write_scope": self.write_scope,
            "allowed_roots": [str(path) for path in self.allowed_roots],
            "denied_roots": [str(path) for path in self.denied_roots],
            "denied_tools": list(self.denied_tools),
            "post_validators": list(self.post_validators),
            "require_change_manifest": self.require_change_manifest,
            "rollback_on_failure": self.rollback_on_failure,
        }


@dataclass(frozen=True)
class BackendCapabilities:
    """Features that the Dashboard may safely expose for one backend."""

    structured_output: bool = False
    streaming: bool = False
    sessions: bool = False
    model_selection: bool = False
    reasoning_effort: bool = False
    service_tier: bool = False
    file_write: bool = False
    web_search: bool = False
    citations: bool = False
    image_input: bool = False

    def to_payload(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class BackendCommandRequest:
    """Backend-neutral command inputs produced by the action runner."""

    action: str
    agent: str
    project_root: Path
    sandbox: str
    writes: bool
    model: str
    reasoning_effort: str
    service_tier: str
    retrieval_mode: str = "vault"
    output_schema: Path | None = None
    access_policy: BackendAccessPolicy | None = None
    backend_options: dict[str, Any] = field(default_factory=dict)

    def resolved_access_policy(self) -> BackendAccessPolicy:
        if self.access_policy is not None:
            return self.access_policy
        return BackendAccessPolicy(
            mode="workspace-write" if self.writes else "read-only",
            write_scope="full" if self.writes else "none",
            allowed_roots=(self.project_root,),
        )


@dataclass
class ParsedBackendEvent:
    """Normalized meaning extracted from one backend-native event."""

    dashboard_events: list[dict[str, Any]] = field(default_factory=list)
    final_messages: list[str] = field(default_factory=list)
    source_urls: set[str] = field(default_factory=set)
    search_queries: list[str] = field(default_factory=list)


class AgentCliBackend(Protocol):
    """Interface implemented by every CLI dialect adapter."""

    backend_id: str
    label: str
    capabilities: BackendCapabilities

    def effective_service_tier(self, model: str, requested: str) -> str:
        """Return the supported service tier for this model."""

    def build_command(
        self,
        executable: str,
        request: BackendCommandRequest,
    ) -> list[str]:
        """Build a shell-free argument array for one task."""

    def parse_event(self, payload: dict[str, Any]) -> ParsedBackendEvent:
        """Translate one backend-native JSON event into Dashboard meaning."""

    def describe(self) -> dict[str, Any]:
        """Return versioned discovery metadata."""
