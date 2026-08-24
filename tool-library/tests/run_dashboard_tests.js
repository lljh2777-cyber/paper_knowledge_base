"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "../..");
const python = process.env.DASHBOARD_PYTHON || "D:\\python\\python.exe";
const commands = [
	[process.execPath, ["tool-library/tests/test_dashboard_providers.js"]],
	[process.execPath, ["tool-library/tests/test_dashboard_direct_api_boundary.js"]],
	[process.execPath, ["tool-library/tests/test_dashboard_query_view.js"]],
	[process.execPath, ["tool-library/tests/test_dashboard_annotations.js"]],
	[process.execPath, ["tool-library/tests/test_dashboard_paper_actions.js"]],
	[process.execPath, ["tool-library/tests/test_dashboard_mineru_reader.js"]],
	[python, ["-m", "unittest", "discover", "-s", "tool-library/tests", "-p", "test_*.py"]],
];

for (const [command, args] of commands) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		encoding: "utf8",
		stdio: "inherit",
		windowsHide: true,
	});
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status || 1);
}

console.log("DASHBOARD_ALL_TESTS_OK");
