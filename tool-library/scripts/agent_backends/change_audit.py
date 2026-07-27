"""Host-side workspace change audit for writable CLI agent runs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
from typing import Any, Iterable

from .base import BackendAccessPolicy


_MAX_BACKUP_BYTES = 32 * 1024 * 1024


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_within(path: Path, root: Path) -> bool:
    path = _canonical_path(path)
    root = _canonical_path(root)
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _canonical_path(path: Path) -> Path:
    """Normalize parent aliases without dereferencing the final path."""

    absolute = path.absolute()
    return Path(os.path.realpath(absolute.parent)) / absolute.name


def _relative_path(path: Path, project_root: Path) -> str:
    try:
        return path.relative_to(project_root).as_posix()
    except ValueError:
        return str(path)


@dataclass(frozen=True)
class FileState:
    path: Path
    kind: str
    digest: str
    size: int
    backup: bytes | None


@dataclass(frozen=True)
class WorkspaceChange:
    path: Path
    kind: str
    allowed: bool
    reason: str = ""

    def to_payload(self, project_root: Path) -> dict[str, Any]:
        return {
            "path": _relative_path(self.path, project_root),
            "kind": self.kind,
            "allowed": self.allowed,
            "reason": self.reason or None,
        }


class WorkspaceChangeAudit:
    """Compare a bounded workspace snapshot before and after one agent run.

    Git-visible files provide broad workspace coverage. Allowed and denied
    roots are always scanned directly so ignored stage outputs and immutable
    source inputs remain inside the audit boundary.
    """

    def __init__(
        self,
        project_root: Path,
        policy: BackendAccessPolicy,
        run_id: str,
        action: str,
        backend_id: str,
    ) -> None:
        self.project_root = project_root.resolve()
        self.policy = policy
        self.run_id = run_id
        self.action = action
        self.backend_id = backend_id
        self.started_at = _utc_now()
        self.baseline: dict[Path, FileState] = {}
        self.changes: list[WorkspaceChange] = []
        self.rollback_result: dict[str, Any] = {
            "attempted": False,
            "succeeded": False,
            "restored_paths": [],
            "errors": [],
        }
        self.validators: list[dict[str, Any]] = []

    def capture(self) -> None:
        self.baseline = self._snapshot()

    def inspect(self) -> list[WorkspaceChange]:
        current = self._snapshot(extra_paths=self.baseline)
        changes: list[WorkspaceChange] = []
        for path in sorted(
            set(self.baseline) | set(current),
            key=lambda item: str(item).lower(),
        ):
            before = self.baseline.get(path)
            after = current.get(path)
            if before is None and after is not None:
                kind = "created"
            elif before is not None and after is None:
                kind = "deleted"
            elif before == after:
                continue
            elif (
                before is not None
                and after is not None
                and before.kind != after.kind
            ):
                kind = "type-changed"
            else:
                kind = "modified"
            allowed, reason = self._classify(path, kind, after)
            changes.append(
                WorkspaceChange(
                    path=path,
                    kind=kind,
                    allowed=allowed,
                    reason=reason,
                )
            )
        self.changes = changes
        return changes

    def violations(self) -> list[WorkspaceChange]:
        return [change for change in self.changes if not change.allowed]

    def rollback(self) -> dict[str, Any]:
        result = {
            "attempted": True,
            "succeeded": False,
            "restored_paths": [],
            "errors": [],
        }
        for change in reversed(self.changes):
            try:
                if change.kind == "created":
                    if change.path.is_file() or change.path.is_symlink():
                        change.path.unlink()
                        result["restored_paths"].append(
                            _relative_path(change.path, self.project_root)
                        )
                    continue
                baseline = self.baseline.get(change.path)
                if baseline is None or baseline.backup is None:
                    raise RuntimeError("baseline content was not retained")
                if change.path.exists() and change.path.is_dir():
                    raise RuntimeError("changed path became a directory")
                change.path.parent.mkdir(parents=True, exist_ok=True)
                if baseline.kind == "symlink":
                    if change.path.exists() or change.path.is_symlink():
                        change.path.unlink()
                    os.symlink(
                        baseline.backup.decode("utf-8"),
                        change.path,
                    )
                else:
                    change.path.write_bytes(baseline.backup)
                result["restored_paths"].append(
                    _relative_path(change.path, self.project_root)
                )
            except (OSError, RuntimeError, UnicodeDecodeError) as error:
                result["errors"].append(
                    f"{_relative_path(change.path, self.project_root)}: {error}"
                )
        result["succeeded"] = not result["errors"]
        self.rollback_result = result
        return result

    def add_validator(
        self,
        name: str,
        exit_code: int,
        status: str,
        detail: str = "",
    ) -> None:
        self.validators.append(
            {
                "name": name,
                "exit_code": exit_code,
                "status": status,
                "detail": detail or None,
            }
        )

    def write_manifest(self, result_code: int) -> Path:
        target = (
            self.project_root
            / "tool-library"
            / "output"
            / "dashboard-runs"
            / "changes"
            / f"{self.run_id}.json"
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema_version": "1.0",
            "run_id": self.run_id,
            "action": self.action,
            "backend": self.backend_id,
            "started_at": self.started_at,
            "completed_at": _utc_now(),
            "access_policy": self.policy.to_payload(),
            "result_code": result_code,
            "changes": [
                change.to_payload(self.project_root)
                for change in self.changes
            ],
            "violations": [
                change.to_payload(self.project_root)
                for change in self.violations()
            ],
            "rollback": self.rollback_result,
            "validators": self.validators,
        }
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return target

    def _classify(
        self,
        path: Path,
        kind: str,
        current: FileState | None,
    ) -> tuple[bool, str]:
        if any(_is_within(path, root) for root in self.policy.denied_roots):
            return False, "path is inside a denied root"
        if not any(_is_within(path, root) for root in self.policy.allowed_roots):
            return False, "path is outside the stage-owned roots"
        if kind == "deleted":
            return False, "file deletion is not permitted in stage-owned mode"
        if current is not None and current.kind == "symlink":
            return False, "new or modified symbolic links are not permitted"
        return True, ""

    def _snapshot(
        self,
        extra_paths: Iterable[Path] = (),
    ) -> dict[Path, FileState]:
        paths = set(self._git_visible_paths())
        paths.update(_canonical_path(path) for path in extra_paths)
        for root in (*self.policy.allowed_roots, *self.policy.denied_roots):
            paths.update(self._walk_root(root))
        snapshot: dict[Path, FileState] = {}
        for path in paths:
            state = self._read_state(path)
            if state is not None:
                snapshot[path] = state
        return snapshot

    def _git_visible_paths(self) -> list[Path]:
        process = subprocess.run(
            [
                "git",
                "-c",
                f"safe.directory={self.project_root}",
                "ls-files",
                "--cached",
                "--others",
                "--exclude-standard",
                "-z",
            ],
            cwd=self.project_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if process.returncode != 0:
            return []
        return [
            _canonical_path(
                self.project_root
                / item.decode("utf-8", errors="surrogateescape")
            )
            for item in process.stdout.split(b"\0")
            if item
        ]

    def _walk_root(self, root: Path) -> list[Path]:
        if root.is_symlink() or root.is_file():
            return [_canonical_path(root)]
        if not root.is_dir():
            return []
        files: list[Path] = []
        for current_root, directories, filenames in os.walk(
            root,
            followlinks=False,
        ):
            base = Path(current_root)
            symlink_directories = [
                name for name in directories if (base / name).is_symlink()
            ]
            directories[:] = [
                name for name in directories if name not in symlink_directories
            ]
            files.extend(
                _canonical_path(base / name)
                for name in symlink_directories
            )
            files.extend(
                _canonical_path(base / name)
                for name in filenames
            )
        return files

    def _read_state(self, path: Path) -> FileState | None:
        if path.is_symlink():
            target = os.readlink(path).encode("utf-8")
            return FileState(
                path=path,
                kind="symlink",
                digest=hashlib.sha256(target).hexdigest(),
                size=len(target),
                backup=target,
            )
        if not path.is_file():
            return None
        try:
            size = path.stat().st_size
            content = path.read_bytes()
        except OSError:
            return None
        backup = content if size <= _MAX_BACKUP_BYTES else None
        return FileState(
            path=path,
            kind="file",
            digest=hashlib.sha256(content).hexdigest(),
            size=size,
            backup=backup,
        )
