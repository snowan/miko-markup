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

const { createArtifactReview, previewProposal } = await import("../src/index.js");

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
  review.destroy();
  assert.equal(title.hasAttribute("tabindex"), false);
  assert.equal(document.querySelector("[data-miko-markup]"), null);
  root.remove();
});
