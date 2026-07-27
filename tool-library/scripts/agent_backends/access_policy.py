"""Action-level access policies shared by CLI backends."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import BackendAccessPolicy


_STAGE_OWNED_ROOTS: dict[str, tuple[str, ...]] = {
    "code-analysis": (
        "knowledge-base/wiki/code",
        "knowledge-base/代码项目索引.md",
        "knowledge-base/wiki/code/index.md",
        "knowledge-base/wiki/log.md",
    ),
    "synthesis": (
        "knowledge-base/wiki/concepts",
        "knowledge-base/wiki/methods",
        "knowledge-base/wiki/datasets",
        "knowledge-base/wiki/projects",
        "knowledge-base/wiki/mocs",
        "knowledge-base/wiki/synthesis",
        "knowledge-base/研究主题索引.md",
        "knowledge-base/研究方法索引.md",
        "knowledge-base/wiki/index.md",
        "knowledge-base/wiki/log.md",
    ),
}

_FULL_WRITE_ACTIONS = {
    "paper-ingest",
    "pdf-xray",
    "vault-lint-fix",
}


def build_action_access_policy(
    action: str,
    spec: dict[str, Any],
    project_root: Path,
) -> BackendAccessPolicy:
    """Translate an allow-listed Dashboard action into a host policy."""

    root = project_root.resolve()
    writes = bool(spec.get("writes"))
    if not writes:
        return BackendAccessPolicy(
            mode="read-only",
            write_scope="none",
            allowed_roots=(root,),
            denied_tools=(
                "Edit",
                "Write",
                "NotebookEdit",
                "Bash",
            ),
        )

    if action in _STAGE_OWNED_ROOTS:
        allowed_roots = tuple(
            (root / relative).resolve()
            for relative in _STAGE_OWNED_ROOTS[action]
        )
        return BackendAccessPolicy(
            mode="workspace-write",
            write_scope="stage-owned",
            allowed_roots=allowed_roots,
            denied_roots=((root / "tool-library" / "raw").resolve(),),
            post_validators=("vault-lint",),
            require_change_manifest=True,
            rollback_on_failure=True,
        )

    if action in _FULL_WRITE_ACTIONS:
        return BackendAccessPolicy(
            mode="workspace-write",
            write_scope="full",
            allowed_roots=(root,),
            denied_roots=((root / "tool-library" / "raw").resolve(),),
            post_validators=("vault-lint",),
            require_change_manifest=True,
            rollback_on_failure=True,
        )

    return BackendAccessPolicy(
        mode="workspace-write",
        write_scope="restricted",
        allowed_roots=((root / "tool-library" / "output" / "drafts").resolve(),),
        denied_roots=((root / "tool-library" / "raw").resolve(),),
        require_change_manifest=True,
        rollback_on_failure=True,
    )
