import assert from "node:assert/strict";
import test from "node:test";

import {
  createFetchAdapter,
  createReviewRequest,
  normalizeProposal,
  protocol,
} from "../src/index.js";

test("review requests keep the harness-neutral protocol and anchored feedback", () => {
  const request = createReviewRequest({
    artifact: { id: "demo", path: "artifact.html", version: "abc" },
    html: "<main><h1>Hello</h1></main>",
    comments: [{
      id: "c1",
      scope: "element",
      instruction: "Make this clearer",
      anchors: [{ selector: "h1", tag: "h1", textQuote: { exact: "Hello", prefix: "", suffix: "" } }],
    }, {
      id: "c2",
      scope: "artifact",
      instruction: "Use a warmer tone throughout",
      anchors: [{ selector: ":scope", tag: "main", textQuote: { exact: "Hello", prefix: "", suffix: "" } }],
    }],
  });

  assert.equal(request.protocol, protocol);
  assert.equal(request.artifact.path, "artifact.html");
  assert.equal(request.feedback[0].anchors[0].selector, "h1");
  assert.equal(request.feedback[0].instruction, "Make this clearer");
  assert.deepEqual(request.review, {
    totalComments: 2,
    anchoredComments: 1,
    wholePageComments: 1,
    includesWholePage: true,
  });
});

test("Markdown review requests preserve source and line anchors", () => {
  const request = createReviewRequest({
    artifact: { id: "guide", path: "guide.md", version: "sha256:md" },
    source: { format: "markdown", content: "# Guide\n\nStart here.\n" },
    comments: [{
      id: "c1",
      scope: "element",
      instruction: "Make this introduction clearer",
      anchors: [{
        selector: "p:nth-of-type(1)",
        tag: "p",
        textQuote: { exact: "Start here.", prefix: "", suffix: "" },
        sourceRange: { startLine: 3, endLine: 3 },
      }],
    }],
  });

  assert.deepEqual(request.source, { format: "markdown", content: "# Guide\n\nStart here.\n" });
  assert.deepEqual(request.feedback[0].anchors[0].sourceRange, { startLine: 3, endLine: 3 });
});

test("proposal aliases normalize into the small patch contract", () => {
  const proposal = normalizeProposal({
    summary: "Shorten the title",
    changes: [{ selector: "#title", op: "replace-text", text: "A shorter title" }],
  });

  assert.deepEqual(proposal, {
    summary: "Shorten the title",
    patches: [{ selector: "#title", operation: "setText", value: "A shorter title" }],
  });
});

test("source proposals normalize complete Markdown replacements", () => {
  const proposal = normalizeProposal({
    summary: "Clarified the guide",
    patches: [{ operation: "replace-source", format: "markdown", content: "# Clear guide\n" }],
  });

  assert.deepEqual(proposal, {
    summary: "Clarified the guide",
    patches: [{ operation: "replaceSource", format: "markdown", value: "# Clear guide\n" }],
  });
});

test("unsupported patch operations fail with an actionable error", () => {
  assert.throws(
    () => normalizeProposal({ patches: [{ selector: "h1", operation: "executeScript", value: "alert(1)" }] }),
    /Use setText, setHTML, setAttribute, removeAttribute, or replaceSource/,
  );
});

test("malformed patches and SDK-owned attributes fail before preview", () => {
  assert.throws(
    () => normalizeProposal({ patches: [null] }),
    /Patch 1 must be an object/,
  );
  assert.throws(
    () => normalizeProposal({
      patches: [{ selector: "h1", operation: "setAttribute", name: "data-iar-preview", value: "" }],
    }),
    /cannot change "data-iar-preview"/,
  );
});

test("fetch adapter posts the request and normalizes the response", async () => {
  let captured;
  const adapter = createFetchAdapter({
    endpoint: "/agent/edit",
    fetchImpl: async (endpoint, options) => {
      captured = { endpoint, options };
      return {
        ok: true,
        async json() {
          return { patches: [{ selector: "h1", operation: "setText", value: "Updated" }] };
        },
      };
    },
  });

  const request = createReviewRequest({ html: "<h1>Before</h1>" });
  const proposal = await adapter(request);

  assert.equal(captured.endpoint, "/agent/edit");
  assert.equal(captured.options.method, "POST");
  assert.equal(JSON.parse(captured.options.body).protocol, protocol);
  assert.equal(proposal.patches[0].value, "Updated");
});

test("fetch adapter reports endpoint failures without hiding the response", async () => {
  const adapter = createFetchAdapter({
    endpoint: "/agent/edit",
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      async text() { return "artifact version is stale"; },
    }),
  });

  await assert.rejects(
    adapter(createReviewRequest()),
    /HTTP 409: artifact version is stale/,
  );
});
