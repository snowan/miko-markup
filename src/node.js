import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { normalizeProposal, protocol } from "./index.js";

const proposalSchemaUrl = new URL("./proposal.schema.json", import.meta.url);
const agentSchemaUrl = new URL("./agent-output.schema.json", import.meta.url);
const agentSchemaPath = fileURLToPath(agentSchemaUrl);
let schemaPromise;

const HTML_PROMPT = [
  "Update one rendered HTML artifact from the review request supplied on stdin.",
  "Address every feedback item and keep unrelated content unchanged.",
  "Prefer the selectors supplied in each anchor and use commentId to connect a patch to its comment.",
  "Use DOM patch operations and set selector, value, name, format, and commentId fields that do not apply to null.",
  "Return only a proposal matching the required JSON schema.",
].join(" ");

function defaultPrompt(request) {
  if (typeof request.source?.format === "string" && typeof request.source?.content === "string") {
    return [
      `Update one ${request.source.format} artifact from request.source.content using the review feedback supplied on stdin.`,
      "Address every feedback item, use sourceRange and textQuote anchors to locate each comment, and keep unrelated source unchanged.",
      `Return exactly one replaceSource patch with format ${JSON.stringify(request.source.format)} and the complete updated source in value.`,
      "Set selector, name, and commentId to null.",
      "Return only a proposal matching the required JSON schema.",
    ].join(" ");
  }
  return HTML_PROMPT;
}

async function proposalSchema() {
  schemaPromise ??= readFile(agentSchemaUrl, "utf8").then(JSON.parse);
  return schemaPromise;
}

function validateRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("The adapter needs a MikoMarkup review request.");
  if (request.protocol !== protocol) throw new Error(`Expected protocol ${protocol}, received ${request.protocol ?? "none"}.`);
  const hasHtml = typeof request.source?.html === "string";
  const hasTypedSource = typeof request.source?.format === "string" && typeof request.source?.content === "string";
  if (!hasHtml && !hasTypedSource) {
    throw new Error("The review request needs source HTML or a format and content source pair.");
  }
  if (!Array.isArray(request.feedback)) throw new Error("The review request has no feedback array.");
}

function runCommand(command, args, { cwd, env, input, timeoutMs = 120_000, maxOutputBytes = 4_000_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const stopChild = () => {
      child.kill("SIGTERM");
      const hardStop = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1_000);
      hardStop.unref();
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const append = (stream, chunk) => {
      const next = stream === "stdout" ? stdout + chunk : stderr + chunk;
      if (Buffer.byteLength(next) > maxOutputBytes) {
        stopChild();
        finish(reject, new Error(`${command} exceeded the ${maxOutputBytes}-byte output limit.`));
        return;
      }
      if (stream === "stdout") stdout = next;
      else stderr = next;
    };

    const timer = setTimeout(() => {
      stopChild();
      finish(reject, new Error(`${command} did not finish within ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => finish(reject, new Error(`Could not start ${command}: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, new Error(`${command} exited with code ${code}. Check its authentication and run it directly on the server for diagnostics.`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function parseJson(value, label) {
  try {
    return JSON.parse(value.trim());
  } catch {
    throw new Error(`${label} returned output that was not valid JSON.`);
  }
}

function commonOptions(options) {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  };
}

/** Create a server-side adapter backed by Codex non-interactive mode. */
export function createCodexAdapter(options = {}) {
  return async function codexAdapter(request) {
    validateRequest(request);
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--output-schema",
      agentSchemaPath,
      "-C",
      options.cwd ?? process.cwd(),
    ];
    if (options.model) args.push("--model", options.model);
    if (options.skipGitRepoCheck) args.push("--skip-git-repo-check");
    args.push(options.prompt ?? defaultPrompt(request));

    const result = await runCommand(options.command ?? "codex", args, {
      ...commonOptions(options),
      input: JSON.stringify(request),
    });
    return normalizeProposal(parseJson(result.stdout, "Codex"));
  };
}

/** Create a server-side adapter backed by Claude Code print mode. */
export function createClaudeCodeAdapter(options = {}) {
  return async function claudeCodeAdapter(request) {
    validateRequest(request);
    const schema = await proposalSchema();
    const args = [
      "--print",
      options.prompt ?? defaultPrompt(request),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--no-session-persistence",
      "--disable-slash-commands",
      "--tools",
      "",
    ];
    if (options.model) args.push("--model", options.model);
    if (options.maxBudgetUsd != null) args.push("--max-budget-usd", String(options.maxBudgetUsd));

    const result = await runCommand(options.command ?? "claude", args, {
      ...commonOptions(options),
      input: JSON.stringify(request),
    });
    const envelope = parseJson(result.stdout, "Claude Code");
    const proposal = envelope.structured_output
      ?? (typeof envelope.result === "string" ? parseJson(envelope.result, "Claude Code result") : envelope.result);
    return normalizeProposal(proposal);
  };
}

export const proposalSchemaPath = fileURLToPath(proposalSchemaUrl);
export const agentOutputSchemaPath = agentSchemaPath;
