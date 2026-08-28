# MikoMarkup

Select rendered HTML, leave comments where the changes belong, and send the
whole review to an agent. MikoMarkup previews the proposed updates in place and
lets the user apply or discard them.

MikoMarkup is a small SDK, not another artifact manager. Your product keeps its
existing viewer, authentication, source files, versions, and save behavior.

## What it adds

- Anchored comments on any HTML section.
- As many section comments as the user needs, plus whole-page feedback.
- Direct inline text editing.
- One harness-neutral JSON request containing the complete review.
- In-place preview with apply and discard controls.
- Server-side adapters for Codex and Claude Code.

The demo uses a simulated agent so it works without credentials:

```bash
npm install
npm run demo
```

Then open <http://127.0.0.1:3000/demo/>.

## Install

Until an npm registry release is published, install directly from GitHub:

```bash
npm install github:snowan/miko-markup
```

## Add it to an artifact viewer

```html
<main id="artifact">…your existing artifact…</main>

<script type="module">
  import {
    createArtifactReview,
    createFetchAdapter,
  } from "miko-markup";

  createArtifactReview({
    root: "#artifact",
    artifact: { id: "report-42", version: "sha256:…" },
    adapter: createFetchAdapter({ endpoint: "/api/artifacts/review" }),
    onApply: ({ html }) =>
      fetch("/api/artifacts/report-42", {
        method: "PUT",
        headers: { "content-type": "text/html" },
        body: html,
      }),
  }).enable();
</script>
```

Add `data-artifact-id` to important sections when you control the markup. It
creates a stable anchor and makes those sections keyboard-selectable while
review mode is active. Otherwise, MikoMarkup falls back to an element ID or a
root-relative CSS path and includes a text quote for reanchoring.

## Connect an agent

The browser sends one review request to your trusted server. The server invokes
the chosen agent and returns the same small patch proposal regardless of the
harness.

```text
artifact viewer -> MikoMarkup request -> trusted server adapter
                                           | Codex
                                           | Claude Code
                                           | another harness
artifact viewer <- preview proposal <------+
```

Codex:

```js
import { createCodexAdapter } from "miko-markup/node";

const reviewArtifact = createCodexAdapter({
  cwd: process.cwd(),
});

app.post("/api/artifacts/review", async (request, response) => {
  response.json(await reviewArtifact(request.body));
});
```

Claude Code uses the same endpoint shape:

```js
import { createClaudeCodeAdapter } from "miko-markup/node";

const reviewArtifact = createClaudeCodeAdapter({
  cwd: process.cwd(),
  maxBudgetUsd: 1,
});
```

Both built-in adapters run without a shell, send the rendered HTML through
stdin, disable repository writes, request schema-constrained output, and apply
the same timeout and output limits. The corresponding CLI must already be
installed and authenticated on the server.

For a hosted model, Miko, or another harness, pass any async function:

```js
const adapter = async (reviewRequest) => {
  const result = await myHarness.run({
    task: "Update this HTML from the attached anchored feedback",
    input: reviewRequest,
  });
  return result.proposal;
};
```

See [the integration guide](docs/integration.md) for iframe, generated-source,
versioning, and persistence guidance. The stable wire format lives in
[the protocol reference](docs/protocol.md).

## Safety boundary

- Agent execution belongs on a trusted server or local daemon, never in the
  browser.
- `onApply` is the persistence boundary. Without it, an accepted preview only
  changes the current page.
- Treat `artifact.version` as an optimistic-concurrency token and reject stale
  writes before changing canonical source.
- Built-in `setHTML` previews remove executable elements, event handlers,
  inline styles, unsafe URL protocols, forms, frames, and embedded objects.
- Use a sandboxed iframe and a host-provided `preview()` callback for executable
  artifacts or framework source patches.

## Development

```bash
npm install
npm run check
npm run pack:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for review expectations.

## License

MIT
