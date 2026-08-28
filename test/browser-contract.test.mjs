import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";

const window = new Window({ url: "http://127.0.0.1/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  Element: window.Element,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
});

const {
  createArtifactReview,
  createMarkdownArtifactReview,
  previewProposal,
  previewSourceProposal,
} = await import("../src/index.js");

test("HTML previews sanitize executable content and roll back once", () => {
  const root = document.createElement("main");
  root.innerHTML = '<section id="target"><p>Before</p></section>';
  document.body.append(root);

  const preview = previewProposal(root, {
    summary: "Preview safe markup",
    patches: [{
      selector: "#target",
      operation: "setHTML",
      value: '<p style="position:fixed" onclick="alert(1)">After</p><a href="java\nscript:alert(1)">Unsafe link</a><script>alert(1)</script>',
    }],
  });

  assert.equal(root.querySelector("script"), null);
  assert.equal(root.querySelector("p").getAttribute("style"), null);
  assert.equal(root.querySelector("p").getAttribute("onclick"), null);
  assert.equal(root.querySelector("a").getAttribute("href"), null);
  preview.rollback();
  preview.rollback();
  assert.equal(root.querySelector("#target").innerHTML, "<p>Before</p>");
  root.remove();
});

test("source preview rollback restores clean rendered markup", async () => {
  const root = document.createElement("main");
  root.innerHTML = '<h1 tabindex="0" data-iar-keyboard data-iar-tabindex>Before</h1>';
  document.body.append(root);

  const preview = await previewSourceProposal(root, {
    summary: "Replace the source",
    patches: [{ operation: "replaceSource", format: "markdown", value: "# After\n" }],
  }, {
    format: "markdown",
    render: () => '<h1 data-artifact-line-start="1">After</h1>',
  });

  assert.equal(root.querySelector("h1").textContent, "After");
  preview.rollback();
  assert.equal(root.innerHTML, "<h1>Before</h1>");
  root.remove();
});

test("review UI batches keyboard-selected and whole-page comments before apply", async () => {
  const root = document.createElement("main");
  root.id = "artifact";
  root.innerHTML = '<section data-artifact-id="hero" data-artifact-section><h1 data-artifact-id="title">Long title</h1></section>';
  document.body.append(root);
  let receivedRequest;
  let applied;

  const review = createArtifactReview({
    root,
    artifact: { id: "demo", version: "v1" },
    adapter: async (request) => {
      receivedRequest = request;
      return {
        summary: "Shortened the title",
        patches: [{ selector: '[data-artifact-id="title"]', operation: "setText", value: "Short title" }],
      };
    },
    onApply: async (payload) => { applied = payload; },
  });

  review.enable();
  const title = root.querySelector("h1");
  assert.equal(title.getAttribute("tabindex"), "0");
  title.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  const host = document.querySelector("[data-miko-markup]");
  const panel = host.shadowRoot;
  const textarea = panel.querySelector("textarea");
  textarea.value = "Make this title shorter";
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  panel.querySelector('[data-action="add-comment"]').click();
  panel.querySelector('[data-action="whole-page"]').click();
  panel.querySelector("textarea").value = "Use a warmer tone";
  panel.querySelector("textarea").dispatchEvent(new window.Event("input", { bubbles: true }));
  panel.querySelector('[data-action="add-comment"]').click();
  panel.querySelector('[data-action="send"]').click();
  await window.happyDOM.whenAsyncComplete();

  assert.deepEqual(receivedRequest.review, {
    totalComments: 2,
    anchoredComments: 1,
    wholePageComments: 1,
    includesWholePage: true,
  });
  assert.equal(root.querySelector("h1").textContent, "Short title");
  panel.querySelector('[data-action="apply"]').click();
  await window.happyDOM.whenAsyncComplete();

  assert.match(applied.html, /Short title/);
  assert.doesNotMatch(applied.html, /data-iar-|tabindex="0"/);
  assert.equal(applied.source, undefined);
  review.destroy();
  assert.equal(title.hasAttribute("tabindex"), false);
  assert.equal(document.querySelector("[data-miko-markup]"), null);
  root.remove();
});

test("Markdown review sends source lines, previews replacement source, and applies Markdown", async () => {
  const initialMarkdown = "# A very long guide title\n\nStart with the important idea.\n";
  const render = (markdown) => {
    const lines = markdown.split(/\r?\n/);
    return [
      `<h1 data-artifact-id="title" data-artifact-line-start="1" data-artifact-line-end="1">${lines[0].replace(/^#\s+/, "")}</h1>`,
      `<p data-artifact-line-start="3" data-artifact-line-end="3">${lines[2]}</p>`,
    ].join("");
  };
  const root = document.createElement("main");
  root.innerHTML = render(initialMarkdown);
  document.body.append(root);
  let receivedRequest;
  let applied;

  const review = createMarkdownArtifactReview({
    root,
    artifact: { id: "guide", path: "guide.md", version: "v1" },
    markdown: initialMarkdown,
    render,
    adapter: async (request) => {
      receivedRequest = request;
      return {
        summary: "Shortened the guide title",
        patches: [{
          operation: "replaceSource",
          format: "markdown",
          value: "# Clear guide\n\nStart with the important idea.\n",
        }],
      };
    },
    onApply: async (payload) => { applied = payload; },
  });

  review.enable();
  root.querySelector("h1").dispatchEvent(new window.Event("click", { bubbles: true }));
  const panel = document.querySelector("[data-miko-markup]").shadowRoot;
  assert.equal(panel.querySelector('[data-action="edit"]'), null);
  panel.querySelector("textarea").value = "Make this title shorter";
  panel.querySelector("textarea").dispatchEvent(new window.Event("input", { bubbles: true }));
  panel.querySelector('[data-action="add-comment"]').click();
  panel.querySelector('[data-action="whole-page"]').click();
  panel.querySelector("textarea").value = "Make the whole guide warmer";
  panel.querySelector("textarea").dispatchEvent(new window.Event("input", { bubbles: true }));
  panel.querySelector('[data-action="add-comment"]').click();
  panel.querySelector('[data-action="send"]').click();
  await window.happyDOM.whenAsyncComplete();

  assert.deepEqual(receivedRequest.source, { format: "markdown", content: initialMarkdown });
  assert.equal(receivedRequest.review.totalComments, 2);
  assert.equal(receivedRequest.review.wholePageComments, 1);
  assert.deepEqual(receivedRequest.feedback[0].anchors[0].sourceRange, { startLine: 1, endLine: 1 });
  assert.deepEqual(receivedRequest.feedback[1].anchors[0].sourceRange, { startLine: 1, endLine: 4 });
  assert.equal(root.querySelector("h1").textContent, "Clear guide");
  panel.querySelector('[data-action="apply"]').click();
  await window.happyDOM.whenAsyncComplete();

  assert.equal(applied.markdown, "# Clear guide\n\nStart with the important idea.\n");
  assert.deepEqual(applied.source, { format: "markdown", content: applied.markdown });
  assert.equal(review.getMarkdown(), applied.markdown);
  review.destroy();
  root.remove();
});
