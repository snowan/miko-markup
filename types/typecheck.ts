import {
  createArtifactReview,
  createFetchAdapter,
  createReviewRequest,
  normalizeProposal,
  previewProposal,
  type ArtifactProposal,
  type ReviewRequest,
} from "../src/index.js";
import { createClaudeCodeAdapter, createCodexAdapter } from "../src/node.js";

declare const root: Element;

const request: ReviewRequest = createReviewRequest({
  artifact: { id: "type-test", version: "v1" },
  html: "<main><h1>Hello</h1></main>",
  comments: [],
  directEdits: [],
});

const proposal: ArtifactProposal = normalizeProposal({
  patches: [{ selector: "h1", operation: "setText", value: "Hi" }],
});

const preview = previewProposal(root, proposal);
preview.rollback();

createArtifactReview({
  root,
  artifact: { id: "type-test" },
  adapter: createFetchAdapter({ endpoint: "/api/review" }),
  onApply: async ({ html }) => { void html; },
});

void createCodexAdapter({ cwd: "/tmp/project" })(request);
void createClaudeCodeAdapter({ maxBudgetUsd: 1 })(request);
