# Stateless Code Execution for the Obsidian Agent Dashboard

## 1. Purpose

This document specifies a stateless code-practice feature for the Obsidian Agent Dashboard. The feature should let users read a note in one pane and run short Python or R examples in a separate practice pane.

Every execution starts a new operating-system process. When that process exits, its variables, imports, loaded packages, and in-memory state are discarded.

The feature is intended for:

- practicing functions and language syntax while reading notes;
- modifying examples and observing their output;
- running small, self-contained data-processing snippets;
- checking basic Python or R package usage;
- saving useful exercises as linked Markdown notes.

It is not intended for:

- sharing variables between code cells;
- long-running interactive analysis;
- repeatedly loading very large datasets;
- reproducing full Jupyter Notebook kernel behavior.

## 2. User Experience

Add a `Code Practice` action to the Agent Dashboard. The action should open a dedicated Obsidian `ItemView`, preferably beside the note currently being read.

```text
+---------------------------+---------------------------+
| Current note              | Code Practice             |
|                           |                           |
| Method and function notes | [Python] [R]              |
|                           | Code editor               |
|                           |                           |
|                           | [Run] [Stop] [Clear]      |
|                           | Output                    |
+---------------------------+---------------------------+
```

The practice view should contain:

- a Python/R segmented control;
- a code editor;
- Run, Stop, and Clear Output commands;
- the active interpreter path;
- the working directory;
- execution status and duration;
- separate standard output and standard error areas;
- generated image previews;
- a `Save as Practice Note` command.

## 3. Stateless Execution Semantics

Each press of `Run` must:

1. read the current editor content;
2. generate a unique run identifier;
3. create one temporary `.py` or `.R` file;
4. start a new Python or `Rscript` process;
5. capture standard output, standard error, and the exit code;
6. display the result after the process exits;
7. remove the specific temporary file;
8. discard all process memory and runtime state.

For example, this first Python run succeeds:

```python
x = 10
print(x)
```

A later run containing only the following code must fail with `NameError`:

```python
print(x)
```

The second run uses a new process and therefore does not know about `x`.

## 4. Suggested Project Structure

```text
tool-library/
  scripts/
    run_code_practice.py
  output/
    code-practice/
      runs/
      figures/

knowledge-base/
  wiki/
    code/
      practice/
```

Structured run records should be stored under:

```text
tool-library/output/code-practice/runs/<run-id>.json
```

Practice notes explicitly saved by the user should be stored under:

```text
knowledge-base/wiki/code/practice/<practice-slug>.md
```

Temporary source files must not be created inside the knowledge base.

## 5. Execution Architecture

```text
CodePracticeView
    -> structured execution request
    -> run_code_practice.py
    -> request and path validation
    -> temporary source file
    -> Python or Rscript process
    -> stdout, stderr, exit code, and figures
    -> JSON result
    -> rendered output in Obsidian
```

The default Python interpreter is:

```text
D:\python\python.exe
```

The R interpreter should be configurable in the plugin settings, for example:

```text
C:\Program Files\R\R-4.x.x\bin\Rscript.exe
```

The plugin must launch processes with an argument array and without a shell:

```javascript
spawn(executable, args, {
  cwd: workingDirectory,
  shell: false,
  windowsHide: true
});
```

User code must never be concatenated into a shell command.

## 6. Request and Result Contracts

Example execution request:

```json
{
  "language": "python",
  "code": "print(1 + 1)",
  "working_directory": "tool-library/output/code-practice",
  "timeout_seconds": 30
}
```

Example execution result:

```json
{
  "run_id": "20260715-143012-a1b2c3",
  "status": "success",
  "language": "python",
  "exit_code": 0,
  "duration_ms": 134,
  "stdout": "2\n",
  "stderr": "",
  "figures": []
}
```

Supported status values should be limited to:

```text
queued
running
success
failed
timeout
stopped
```

## 7. Output Handling

The output view should display:

- `stdout` for normal process output;
- `stderr` for warnings and errors;
- the process exit code;
- execution duration;
- generated image paths or previews;
- the final execution status.

Python tracebacks and R error messages must remain visible. The interface should not replace useful diagnostic output with a generic `Execution failed` message.

Output should be capped, for example at the last 100,000 characters, so excessive printing cannot freeze Obsidian.

## 8. Figure Output

The first version should support explicitly saved image files instead of implementing the complete Jupyter rich-display protocol.

Python example:

```python
import matplotlib.pyplot as plt

plt.plot([1, 2, 3])
plt.savefig("practice_plot.png", dpi=150, bbox_inches="tight")
```

R example:

```r
png("practice_plot.png", width = 1200, height = 800)
plot(c(1, 2, 3))
dev.off()
```

After execution, the runner may inspect the run-specific output directory for newly created `.png`, `.jpg`, or `.svg` files and return those paths to the plugin.

## 9. Saved Practice Notes

A saved practice note may use the following frontmatter:

```yaml
---
type: code-practice
title: Seurat Filtering Practice
language: R
related_note: "[[Single-cell RNA-seq]]"
execution_mode: stateless
created: 2026-07-15
updated: 2026-07-15
tags:
  - code-practice
  - R
---
```

Recommended body structure:

````markdown
## Goal

Understand how `subset()` filters a Seurat object.

## Code

```r
result <- subset(pbmc, subset = nFeature_RNA > 200)
print(result)
```

## Output

Status: success<br>
Duration: 0.42 seconds

```text
An object of class Seurat
```

## Notes

This example uses stateless execution. Required packages, data, and objects must be loaded or created in the same run.
````

## 10. Security Boundary

Stateless execution is not a security sandbox. Executed code still has the file-system permissions of the current operating-system user.

The implementation must:

- restrict the default working directory to `tool-library/output/code-practice/`;
- launch processes with `shell: false`;
- enforce a default timeout, such as 30 seconds;
- provide a Stop command;
- limit captured output size;
- avoid automatic package installation;
- avoid automatic network access;
- avoid administrator privileges;
- prohibit modifications under `tool-library/raw/`;
- delete temporary files only by one explicit path at a time.

The interface should require explicit confirmation before:

- using a working directory outside the configured project area;
- enabling network access;
- writing to arbitrary locations;
- extending the execution timeout substantially;
- installing dependencies;
- running code that contains obvious destructive file operations.

If stronger isolation is required, execution should later move into WSL, a container, or another dedicated sandbox.

## 11. Minimum Viable Product

The first implementation should include:

- one Python/R code editor;
- stateless process execution;
- standard output and standard error rendering;
- timeout and manual stop controls;
- configurable interpreter paths;
- association with the currently open note;
- saving a practice session as Markdown;
- basic generated-image discovery.

The first implementation should not include:

- a persistent Jupyter kernel;
- shared variables across cells;
- an interactive debugger;
- automatic dependency installation;
- rich DataFrame rendering;
- arbitrary HTML or JavaScript output;
- remote compute environments.

## 12. Acceptance Criteria

The feature is complete when:

- consecutive runs do not share variables;
- Python and R can both return standard output;
- syntax and runtime errors are shown in full;
- infinite loops are terminated by the timeout;
- users can manually stop a running process;
- code and output remain readable in a narrow Obsidian pane;
- long output cannot freeze the interface;
- paths containing spaces and Chinese characters work correctly;
- temporary source files do not remain in the knowledge base;
- saved practice notes link back to the note being studied;
- failed runs never modify the original code note;
- interrupted runs are not shown as active after the plugin restarts.

## 13. Future Extension

After the stateless implementation is stable, a separate stateful mode may integrate a Jupyter kernel. That mode should be treated as a distinct execution backend because it introduces kernel lifecycle management, shared memory, execution ordering, WebSocket communication, richer output formats, and more complex failure recovery.
