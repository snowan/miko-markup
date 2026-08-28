import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createReviewRequest } from "../src/index.js";
import { createClaudeCodeAdapter, createCodexAdapter } from "../src/node.js";

async function fakeCommand(output) {
  const directory = await mkdtemp(join(tmpdir(), "miko-markup-test-"));
  const command = join(directory, "agent.mjs");
  await writeFile(command, `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on("end", () => process.stdout.write(${JSON.stringify(JSON.stringify(output))}));\n`);
  await chmod(command, 0o755);
  return command;
}

async function failingCommand() {
  const directory = await mkdtemp(join(tmpdir(), "miko-markup-test-"));
  const command = join(directory, "agent.mjs");
  await writeFile(command, '#!/usr/bin/env node\nprocess.stderr.write("private artifact text");\nprocess.exit(2);\n');
  await chmod(command, 0o755);
  return command;
}

const request = createReviewRequest({
  html: "<main><h1>Hello</h1></main>",
  comments: [{
    id: "c1",
    scope: "element",
    instruction: "Shorten the title",
    anchors: [{ selector: "h1", tag: "h1", textQuote: { exact: "Hello", prefix: "", suffix: "" } }],
  }],
});

test("Codex adapter normalizes schema-constrained CLI output", async () => {
  const command = await fakeCommand({
    summary: "Updated the title",
    patches: [{ selector: "h1", operation: "setText", value: "Hi" }],
  });
  const adapter = createCodexAdapter({ command, skipGitRepoCheck: true });

  const proposal = await adapter(request);
  assert.equal(proposal.patches[0].value, "Hi");
});

test("Claude Code adapter reads structured output from the CLI envelope", async () => {
  const command = await fakeCommand({
    structured_output: {
      summary: "Updated the title",
      patches: [{ selector: "h1", operation: "setText", value: "Hello there" }],
    },
  });
  const adapter = createClaudeCodeAdapter({ command });

  const proposal = await adapter(request);
  assert.equal(proposal.patches[0].value, "Hello there");
});

test("agent adapters reject another protocol before starting a process", async () => {
  const adapter = createCodexAdapter({ command: "/does/not/exist" });
  await assert.rejects(
    adapter({ ...request, protocol: "another-tool/1" }),
    /Expected protocol miko-markup\/1/,
  );
});

test("agent process failures do not echo artifact or CLI stderr", async () => {
  const command = await failingCommand();
  const adapter = createCodexAdapter({ command });
  await assert.rejects(
    adapter(request),
    (error) => error.message.includes("exited with code 2") && !error.message.includes("private artifact text"),
  );
});
