#!/usr/bin/env python3
"""Run one stateless Python or R code-practice request.

The request is read as JSON from stdin. User code is written to one explicitly
named temporary source file and executed without a shell in a fresh process.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid
from typing import Any, TextIO


DEFAULT_PYTHON = r"D:\python\python.exe"
DEFAULT_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 120
MAX_CODE_CHARS = 200_000
MAX_OUTPUT_CHARS = 100_000
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}$")
FIGURE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg"}

BLOCKED_PATTERNS = (
    (re.compile(r"\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree)\s*\("), "destructive Python file operation"),
    (re.compile(r"\.(?:unlink|rmdir)\s*\("), "destructive path operation"),
    (re.compile(r"\b(?:file\.remove|unlink)\s*\("), "destructive R file operation"),
    (re.compile(r"\b(?:subprocess\.|os\.system\s*\(|system2?\s*\(|shell\s*\()"), "external command execution"),
    (re.compile(r"\b(?:pip\s+install|install\.packages\s*\(|BiocManager::install\s*\(|remotes::install_)"), "package installation"),
    (re.compile(r"\b(?:(?:import|from)\s+(?:requests|urllib|http|socket)\b|requests\.|urllib\.|http\.client|socket\.|download\.file\s*\(|httr::|curl::|library\s*\(\s*[\"']?(?:httr|curl))"), "network access"),
)


class RequestError(ValueError):
    """The request violates the code-practice contract."""


class CappedTextBuffer:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.value = ""
        self.truncated = False
        self.lock = threading.Lock()

    def append(self, text: str) -> None:
        with self.lock:
            self.value += text
            if len(self.value) > self.limit:
                self.value = self.value[-self.limit :]
                self.truncated = True

    def render(self) -> str:
        with self.lock:
            prefix = "[Earlier output truncated]\n" if self.truncated else ""
            return prefix + self.value


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run one stateless code-practice request.")
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--python", default=DEFAULT_PYTHON)
    parser.add_argument("--rscript", default="")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def make_run_id() -> str:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{uuid.uuid4().hex[:6]}"


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def resolve_executable(value: str, label: str) -> str:
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return str(candidate.resolve())
    raise RequestError(f"{label} executable not found: {value or '(not configured)'}")


def validate_request(raw: Any, project_root: Path) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RequestError("Request must be a JSON object")

    language = str(raw.get("language", "")).strip().lower()
    if language not in {"python", "r"}:
        raise RequestError("language must be `python` or `r`")

    code = raw.get("code")
    if not isinstance(code, str) or not code.strip():
        raise RequestError("code must be a non-empty string")
    context_code = raw.get("context_code", "")
    if not isinstance(context_code, str):
        raise RequestError("context_code must be a string")
    if len(code) + len(context_code) > MAX_CODE_CHARS:
        raise RequestError(f"combined code exceeds {MAX_CODE_CHARS} characters")

    timeout_seconds = int(raw.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS))
    if not 1 <= timeout_seconds <= MAX_TIMEOUT_SECONDS:
        raise RequestError(f"timeout_seconds must be between 1 and {MAX_TIMEOUT_SECONDS}")

    requested_id = str(raw.get("run_id", "")).strip().lower()
    run_id = requested_id or make_run_id()
    if not RUN_ID_RE.fullmatch(run_id):
        raise RequestError("run_id has an invalid format")

    output_root = (project_root / "tool-library" / "output" / "code-practice").resolve()
    requested_workdir = str(raw.get("working_directory", "tool-library/output/code-practice")).strip()
    working_base = (project_root / requested_workdir).resolve()
    if not is_within(working_base, output_root):
        raise RequestError("working_directory must stay under tool-library/output/code-practice")

    combined_code = f"{context_code}\n{code}"
    for pattern, label in BLOCKED_PATTERNS:
        if pattern.search(combined_code):
            raise RequestError(f"Blocked by code-practice policy: {label}")

    return {
        "language": language,
        "code": code,
        "context_code": context_code,
        "timeout_seconds": timeout_seconds,
        "run_id": run_id,
        "output_root": output_root,
        "working_base": working_base,
    }


def build_source(language: str, context_code: str, code: str) -> str:
    """Build one process-local replay script while exposing only target output."""
    if language == "python":
        return "\n".join(
            [
                "import ast as __practice_ast_module",
                "import contextlib as __practice_contextlib",
                "import io as __practice_io",
                f"__practice_context_code = {context_code!r}",
                f"__practice_target_code = {code!r}",
                "__practice_namespace = {'__name__': '__main__'}",
                "if __practice_context_code.strip():",
                "    with __practice_contextlib.redirect_stdout(__practice_io.StringIO()), \\",
                "         __practice_contextlib.redirect_stderr(__practice_io.StringIO()):",
                "        exec(compile(__practice_context_code, '<replayed cells>', 'exec'), __practice_namespace, __practice_namespace)",
                "__practice_tree = __practice_ast_module.parse(__practice_target_code, '<current cell>', 'exec')",
                "if __practice_tree.body and isinstance(__practice_tree.body[-1], __practice_ast_module.Expr):",
                "    __practice_prefix = __practice_ast_module.Module(body=__practice_tree.body[:-1], type_ignores=[])",
                "    if __practice_prefix.body:",
                "        exec(compile(__practice_prefix, '<current cell>', 'exec'), __practice_namespace, __practice_namespace)",
                "    __practice_expression = __practice_ast_module.Expression(__practice_tree.body[-1].value)",
                "    __practice_value = eval(compile(__practice_expression, '<current cell>', 'eval'), __practice_namespace, __practice_namespace)",
                "    if __practice_value is not None:",
                "        print(repr(__practice_value))",
                "else:",
                "    exec(compile(__practice_tree, '<current cell>', 'exec'), __practice_namespace, __practice_namespace)",
                "",
            ]
        )

    context_literal = json.dumps(context_code, ensure_ascii=True)
    code_literal = json.dumps(code, ensure_ascii=True)
    return "\n".join(
        [
            f".practice_context_code <- {context_literal}",
            f".practice_target_code <- {code_literal}",
            ".practice_env <- new.env(parent = .GlobalEnv)",
            "if (nzchar(trimws(.practice_context_code))) {",
            "  invisible(capture.output(",
            "    suppressWarnings(suppressMessages(eval(parse(text = .practice_context_code), envir = .practice_env))),",
            "    type = \"output\"",
            "  ))",
            "}",
            ".practice_result <- withVisible(eval(parse(text = .practice_target_code), envir = .practice_env))",
            "if (.practice_result$visible) print(.practice_result$value)",
            "",
        ]
    )


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def stream_to_buffer(stream: TextIO | None, buffer: CappedTextBuffer) -> None:
    if stream is None:
        return
    try:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            buffer.append(chunk)
    finally:
        stream.close()


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def discover_figures(run_directory: Path, project_root: Path) -> list[str]:
    figures: list[str] = []
    for candidate in sorted(run_directory.rglob("*")):
        if candidate.is_file() and candidate.suffix.lower() in FIGURE_EXTENSIONS:
            figures.append(candidate.resolve().relative_to(project_root).as_posix())
    return figures[:20]


def execute_request(
    request: dict[str, Any],
    project_root: Path,
    python_value: str,
    rscript_value: str,
) -> dict[str, Any]:
    validated = validate_request(request, project_root)
    language = validated["language"]
    run_id = validated["run_id"]
    output_root: Path = validated["output_root"]
    run_directory = output_root / "figures" / run_id
    temp_directory = output_root / "temp"
    stop_directory = output_root / "stop"
    record_path = output_root / "runs" / f"{run_id}.json"
    source_suffix = ".py" if language == "python" else ".R"
    source_path = temp_directory / f"{run_id}{source_suffix}"
    stop_path = stop_directory / f"{run_id}.stop"

    run_directory.mkdir(parents=True, exist_ok=True)
    temp_directory.mkdir(parents=True, exist_ok=True)
    stop_directory.mkdir(parents=True, exist_ok=True)
    if stop_path.exists():
        stop_path.unlink()

    interpreter = resolve_executable(python_value, "Python") if language == "python" else resolve_executable(rscript_value, "Rscript")
    command = [interpreter, str(source_path)] if language == "python" else [interpreter, "--vanilla", str(source_path)]
    source_path.write_text(
        build_source(language, validated["context_code"], validated["code"]),
        encoding="utf-8",
    )

    started_at = utc_now()
    started = time.monotonic()
    result: dict[str, Any] = {
        "run_id": run_id,
        "status": "running",
        "language": language,
        "interpreter": interpreter,
        "working_directory": run_directory.resolve().relative_to(project_root).as_posix(),
        "exit_code": None,
        "duration_ms": 0,
        "stdout": "",
        "stderr": "",
        "figures": [],
        "execution_mode": "stateless-replay" if validated["context_code"].strip() else "stateless",
        "started_at": started_at,
        "finished_at": "",
    }
    write_json_atomic(record_path, result)

    stdout_buffer = CappedTextBuffer(MAX_OUTPUT_CHARS)
    stderr_buffer = CappedTextBuffer(MAX_OUTPUT_CHARS)
    process: subprocess.Popen[str] | None = None
    status = "failed"

    try:
        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["CODE_PRACTICE_RUN_ID"] = run_id
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            env.pop(key, None)
        process = subprocess.Popen(
            command,
            cwd=run_directory,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        stdout_thread = threading.Thread(target=stream_to_buffer, args=(process.stdout, stdout_buffer), daemon=True)
        stderr_thread = threading.Thread(target=stream_to_buffer, args=(process.stderr, stderr_buffer), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        deadline = started + validated["timeout_seconds"]
        while process.poll() is None:
            if stop_path.exists():
                status = "stopped"
                terminate_process(process)
                break
            if time.monotonic() >= deadline:
                status = "timeout"
                terminate_process(process)
                break
            time.sleep(0.1)

        if process.poll() is None:
            terminate_process(process)
        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
        if status not in {"stopped", "timeout"}:
            status = "success" if process.returncode == 0 else "failed"

        result.update(
            {
                "status": status,
                "exit_code": process.returncode,
                "stdout": stdout_buffer.render(),
                "stderr": stderr_buffer.render(),
                "figures": discover_figures(run_directory, project_root),
            }
        )
        if status == "timeout":
            result["stderr"] = (result["stderr"] + f"\nExecution timed out after {validated['timeout_seconds']} seconds.").strip()
        elif status == "stopped":
            result["stderr"] = (result["stderr"] + "\nExecution stopped by user.").strip()
    finally:
        result["duration_ms"] = round((time.monotonic() - started) * 1000)
        result["finished_at"] = utc_now()
        if source_path.exists():
            source_path.unlink()
        if stop_path.exists():
            stop_path.unlink()
        write_json_atomic(record_path, result)

    return result


def main() -> int:
    configure_utf8_stdio()
    args = parse_args()
    project_root = args.project_root.expanduser().resolve()
    if not project_root.is_dir() or not (project_root / "AGENTS.md").is_file():
        raise RequestError(f"Invalid project root: {project_root}")

    request: Any = {}
    try:
        request = json.load(sys.stdin)
        result = execute_request(request, project_root, args.python, args.rscript)
    except (json.JSONDecodeError, OSError, RequestError, ValueError) as error:
        requested_id = str(request.get("run_id", "")) if isinstance(request, dict) else ""
        run_id = requested_id if RUN_ID_RE.fullmatch(requested_id) else ""
        result = {
            "run_id": run_id,
            "status": "failed",
            "language": str(request.get("language", "")) if isinstance(request, dict) else "",
            "exit_code": None,
            "duration_ms": 0,
            "stdout": "",
            "stderr": str(error),
            "figures": [],
            "started_at": utc_now(),
            "finished_at": utc_now(),
        }
        if run_id:
            record_path = project_root / "tool-library" / "output" / "code-practice" / "runs" / f"{run_id}.json"
            write_json_atomic(record_path, result)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
