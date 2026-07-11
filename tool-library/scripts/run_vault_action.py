#!/usr/bin/env python3
"""Run one allow-listed Research Vault action for the Obsidian dashboard.

User input is read from stdin and passed to Codex through stdin. Commands are
always constructed as argument arrays; this runner never invokes a shell.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any


DEFAULT_CODEX = r"C:\Users\Thomas Wade\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe"
DEFAULT_PYTHON = r"D:\python\python.exe"


ACTION_SPECS: dict[str, dict[str, Any]] = {
    "paper-ingest": {
        "label": "文献入库",
        "agent": "research-vault-ingest",
        "sandbox": "workspace-write",
        "input_required": True,
        "writes": True,
        "instructions": """
Use the `research-vault-ingest` skill for this task. Perform source identity,
metadata normalization, duplicate checks, attachment/source-path discovery,
evidence-consistency checks, and the metadata/index/log updates owned by the
ingest stage. Do not write paper conclusions and do not claim evidence beyond
`metadata-only`. If metadata and source evidence conflict, stop before writing
conclusions and record the gap according to the workspace rules.
""",
    },
    "pdf-xray": {
        "label": "PDF 深读",
        "agent": "paper_xray",
        "sandbox": "workspace-write",
        "input_required": True,
        "writes": True,
        "instructions": """
Spawn the project custom agent `paper_xray` and use the
`research-vault-xray` skill. Inspect the full text, methods, figures/tables,
data/materials, limitations, and evidence chain. Upgrade a source note to
`x-ray` only when every required evidence check is complete. Report any
inaccessible or unverified evidence explicitly.
""",
    },
    "code-analysis": {
        "label": "代码分析",
        "agent": "code_reader",
        "sandbox": "workspace-write",
        "input_required": True,
        "writes": True,
        "instructions": """
Spawn the project custom agent `code_reader` and use the
`research-vault-code` skill. Statically inspect the requested R/Python project,
read important scripts directly, and update the linked project/script notes.
Script pages should use selected code snippets followed by Chinese explanation.
Do not run project code, install dependencies, or modify source code. Keep the
analysis depth at `static-read` and mark runtime behavior as unverified when
static evidence is insufficient.
""",
    },
    "vault-retrieval": {
        "label": "知识库检索",
        "agent": "research-vault-retrieval",
        "sandbox": "read-only",
        "input_required": True,
        "writes": False,
        "instructions": """
Use the `research-vault-retrieval` skill. Answer only from evidence already in
the vault, cite the relevant vault notes, and state `Vault 中未找到足够依据`
where evidence is insufficient. This action is read-only: do not create,
modify, move, or delete files. Return the answer in the final response so the
dashboard can display it.
""",
    },
    "synthesis": {
        "label": "综合分析",
        "agent": "research-vault-synthesis",
        "sandbox": "workspace-write",
        "input_required": True,
        "writes": True,
        "instructions": """
Use the `research-vault-synthesis` skill. Perform the requested cross-paper
synthesis or create/update the appropriate MOC, concept, method, dataset, or
project page. Separate vault-backed claims from general or external knowledge,
preserve processing-depth limits, and update the indexes/logs owned by this
stage. Do not perform first-pass source intake or conversion.
""",
    },
    "vault-lint": {
        "label": "知识库体检",
        "agent": "research-vault-lint",
        "kind": "validator",
        "input_required": False,
        "writes": False,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one allow-listed Research Vault dashboard action."
    )
    parser.add_argument("--action", choices=sorted(ACTION_SPECS))
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--codex", default=DEFAULT_CODEX)
    parser.add_argument("--python", default=DEFAULT_PYTHON)
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--list-actions", action="store_true")
    args = parser.parse_args()
    if not args.list_actions and not args.action:
        parser.error("--action is required unless --list-actions is used")
    if args.timeout_seconds < 10:
        parser.error("--timeout-seconds must be at least 10")
    return args


def resolve_executable(value: str, label: str) -> str:
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return str(candidate.resolve())
    discovered = shutil.which(value)
    if discovered:
        return discovered
    raise FileNotFoundError(f"{label} executable not found: {value}")


def validate_project_root(project_root: Path) -> Path:
    root = project_root.expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Project root not found: {root}")
    if not (root / "AGENTS.md").is_file():
        raise FileNotFoundError(f"AGENTS.md not found under project root: {root}")
    return root


def build_prompt(action: str, user_input: str, project_root: Path) -> str:
    spec = ACTION_SPECS[action]
    request = user_input.strip()
    if spec.get("input_required") and not request:
        raise ValueError(f"{spec['label']} requires a non-empty request")

    return f"""You are executing a Research Vault dashboard action in:
{project_root}

Follow the project AGENTS.md and every selected skill instruction exactly.
Keep all work inside the requested action boundary. Do not use destructive
bulk deletion, do not modify tool-library/raw/, and do not install packages.

Action: {spec['label']}
Owning agent or skill: {spec['agent']}
File writes authorized by this action: {'yes, within the owning stage only' if spec['writes'] else 'no'}

Action-specific instructions:
{spec['instructions'].strip()}

User request:
{request}

At completion, report files created or updated, indexes/logs updated or
deliberately skipped, evidence source and processing depth, unresolved gaps,
and skipped steps. Do not ask a follow-up question unless the task cannot
proceed safely without information that is absent from the request.
"""


def build_codex_command(
    codex: str,
    project_root: Path,
    spec: dict[str, Any],
) -> list[str]:
    return [
        codex,
        "exec",
        "--ephemeral",
        "--color",
        "never",
        "-C",
        str(project_root),
        "-s",
        str(spec["sandbox"]),
        "-a",
        "never",
        "-",
    ]


def run_process(
    command: list[str],
    project_root: Path,
    timeout_seconds: int,
    stdin_text: str | None = None,
) -> int:
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    process = subprocess.Popen(
        command,
        cwd=project_root,
        env=env,
        stdin=subprocess.PIPE if stdin_text is not None else None,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    try:
        if stdin_text is not None and process.stdin is not None:
            process.stdin.write(stdin_text)
            process.stdin.close()
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        print(
            f"Action timed out after {timeout_seconds} seconds.",
            file=sys.stderr,
        )
        return 124


def dry_run_payload(
    action: str,
    project_root: Path,
    codex_value: str,
    python_value: str,
    user_input: str,
) -> dict[str, Any]:
    spec = ACTION_SPECS[action]
    if spec.get("kind") == "validator":
        command = [
            python_value,
            str(project_root / "tool-library" / "scripts" / "validate_vault.py"),
        ]
        prompt = ""
    else:
        command = build_codex_command(codex_value, project_root, spec)
        prompt = build_prompt(action, user_input, project_root)
    return {
        "action": action,
        "label": spec["label"],
        "agent": spec["agent"],
        "kind": spec.get("kind", "codex"),
        "sandbox": spec.get("sandbox", "read-only"),
        "writes": spec["writes"],
        "command": command,
        "prompt": prompt,
    }


def main() -> int:
    args = parse_args()
    if args.list_actions:
        print(
            json.dumps(
                {
                    key: {
                        field: value
                        for field, value in spec.items()
                        if field in {"label", "agent", "kind", "sandbox", "input_required", "writes"}
                    }
                    for key, spec in ACTION_SPECS.items()
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    project_root = validate_project_root(args.project_root)
    user_input = sys.stdin.read()
    spec = ACTION_SPECS[args.action]

    if args.dry_run:
        print(
            json.dumps(
                dry_run_payload(
                    args.action,
                    project_root,
                    args.codex,
                    args.python,
                    user_input,
                ),
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    print(f"Starting dashboard action: {spec['label']}", file=sys.stderr)
    if spec.get("kind") == "validator":
        python = resolve_executable(args.python, "Python")
        validator = project_root / "tool-library" / "scripts" / "validate_vault.py"
        if not validator.is_file():
            raise FileNotFoundError(f"Vault validator not found: {validator}")
        command = [python, str(validator)]
        return run_process(command, project_root, args.timeout_seconds)

    codex = resolve_executable(args.codex, "Codex")
    prompt = build_prompt(args.action, user_input, project_root)
    command = build_codex_command(codex, project_root, spec)
    return run_process(command, project_root, args.timeout_seconds, prompt)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error
