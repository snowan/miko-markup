import type { ArtifactProposal, ReviewRequest } from "./index.js";

export type AgentAdapterOptions = {
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  model?: string;
  prompt?: string;
};

export type CodexAdapterOptions = AgentAdapterOptions & {
  skipGitRepoCheck?: boolean;
};

export type ClaudeCodeAdapterOptions = AgentAdapterOptions & {
  maxBudgetUsd?: number;
};

export function createCodexAdapter(options?: CodexAdapterOptions):
  (request: ReviewRequest) => Promise<ArtifactProposal>;

export function createClaudeCodeAdapter(options?: ClaudeCodeAdapterOptions):
  (request: ReviewRequest) => Promise<ArtifactProposal>;

export const proposalSchemaPath: string;
export const agentOutputSchemaPath: string;
