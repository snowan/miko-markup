import {
  createArtifactReview,
  createFetchAdapter,
  createMarkdownArtifactReview,
  createReviewRequest,
  normalizeProposal,
  previewProposal,
  previewSourceProposal,
  type ArtifactProposal,
  type ArtifactSource,
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

const markdownSource: ArtifactSource = { format: "markdown", content: "# Hello\n" };
const markdownRequest: ReviewRequest = createReviewRequest({ source: markdownSource });
const markdownProposal: ArtifactProposal = normalizeProposal({
  patches: [{ operation: "replaceSource", format: "markdown", value: "# Hi\n" }],
});
void previewSourceProposal(root, markdownProposal, {
  format: "markdown",
  render: (content) => `<h1>${content}</h1>`,
});

createArtifactReview({
  root,
  artifact: { id: "type-test" },
  adapter: createFetchAdapter({ endpoint: "/api/review" }),
  onApply: async ({ html }) => { void html; },
});

createMarkdownArtifactReview({
  root,
  markdown: markdownSource.content,
  render: (content) => `<h1>${content}</h1>`,
  adapter: async () => markdownProposal,
  onApply: async ({ markdown, source }) => { void markdown; void source; },
});

void createCodexAdapter({ cwd: "/tmp/project" })(request);
void createClaudeCodeAdapter({ maxBudgetUsd: 1 })(request);
void createCodexAdapter({ cwd: "/tmp/project" })(markdownRequest);
