// PostToolUse hook: after any .ts/.tsx edit, run the incremental typecheck
// (~0.7s) and feed errors straight back to the agent (exit code 2 = stderr
// is shown to Claude as feedback).
const input = await Bun.stdin.text();

let filePath = "";
try {
  filePath = JSON.parse(input)?.tool_input?.file_path ?? "";
} catch {
  process.exit(0);
}
if (!/\.(ts|tsx)$/.test(filePath)) process.exit(0);

const root = import.meta.dir + "/../..";
const proc = Bun.spawnSync(["bun", "run", "--silent", "typecheck"], { cwd: root });
if (proc.exitCode !== 0) {
  console.error(
    `[loop] typecheck failed after editing ${filePath}:\n` +
      proc.stdout.toString() +
      proc.stderr.toString(),
  );
  process.exit(2);
}
