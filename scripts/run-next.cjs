const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function normalizeWindowsPath(value) {
  if (!value) {
    return value;
  }

  if (value.startsWith("\\\\?\\")) {
    return value.slice(4);
  }

  return value;
}

function runNext(command, extraArgs = []) {
  if (!command) {
    throw new Error("Missing Next command");
  }

  const projectRoot = normalizeWindowsPath(path.resolve(__dirname, ".."));
  process.chdir(projectRoot);

  if (command === "predev-clean") {
    fs.rmSync(path.join(projectRoot, ".next-dev"), { recursive: true, force: true });
    return;
  }

  const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, command, ...extraArgs], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      INIT_CWD: normalizeWindowsPath(process.env.INIT_CWD),
      PWD: projectRoot
    }
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = runNext;

if (require.main === module) {
  runNext(process.argv[2], process.argv.slice(3));
}
