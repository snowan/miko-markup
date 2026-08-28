# Integration guide

MikoMarkup has two boundaries: the browser SDK collects review context and
previews changes; a trusted server adapter invokes the agent. Keeping those
roles separate prevents browser code from starting local processes or writing
repository files.

## Same-origin HTML

Mount the SDK around the element that already renders the artifact. Provide an
adapter and let `onApply` call the host's existing save endpoint. This is the
smallest integration and needs no changes to the rest of the product shell.

## Rendered Markdown

Keep Markdown as the canonical source and render it with the parser already
used by the host product. MikoMarkup comments on the rendered DOM but sends the
original Markdown to the agent.

Mark each selectable rendered block with its one-based, inclusive source lines:

```html
<h2
  data-artifact-section
  data-artifact-line-start="8"
  data-artifact-line-end="8"
>Installation</h2>
```

Most Markdown syntax trees expose source positions. Add the attributes while
rendering those nodes, then mount the convenience wrapper:

```js
import {
  createFetchAdapter,
  createMarkdownArtifactReview,
} from "miko-markup";

const review = createMarkdownArtifactReview({
  root: "#preview",
  artifact: { id: "guide", path: "docs/guide.md", version: sourceHash },
  markdown,
  render: renderMarkdown,
  adapter: createFetchAdapter({ endpoint: "/api/artifacts/review" }),
  onApply: ({ markdown: updatedMarkdown }) => saveMarkdown(updatedMarkdown),
});
```

The request includes `{ format: "markdown", content }` and each anchored
comment includes its `sourceRange`. The agent returns one `replaceSource`
patch containing the complete updated Markdown. MikoMarkup calls `render`,
sanitizes its HTML output, and shows that result before apply.

Direct DOM editing is hidden for source-backed Markdown because changing the
rendered HTML would not update the `.md` file. Hosts that need interactive
Markdown components can provide the lower-level `source` and `preview` options
to `createArtifactReview` instead of the convenience wrapper.

## Cross-origin iframe

The parent page cannot inspect a cross-origin iframe's DOM. Choose one of these
patterns:

1. Load MikoMarkup inside the iframe and send review events to the parent with
   `postMessage`.
2. Serve the artifact through a same-origin sandbox route owned by the host.

Validate `event.origin` and the message shape before accepting iframe messages.

## Generated applications

A CSS selector identifies rendered DOM, not necessarily the React, Astro, Vue,
or template source that produced it. For generated artifacts, include stable
source metadata such as `data-artifact-id`, a component ID, and a source path.
The adapter can then return a source diff through a host-provided `preview()`
callback instead of the built-in DOM patcher.

## Codex and Claude Code

Import server adapters from `miko-markup/node`. Both adapters accept the same
review request and return the same proposal.

The Codex adapter uses non-interactive execution with a read-only sandbox and a
JSON Schema output contract. Set `skipGitRepoCheck: true` only when the selected
working directory is intentionally outside Git.

The Claude Code adapter uses print mode, disables tools and session persistence,
and requests structured output with the same schema. `maxBudgetUsd` can cap one
invocation when that option is appropriate for the host.

Neither adapter stores credentials. Each CLI uses its own existing server-side
authentication.

## Persistence

`onApply` receives the complete rendered HTML, inner HTML, proposal, comments,
and direct edits. Source-backed reviews also include `source`; the Markdown
wrapper adds `markdown` for direct persistence. Before saving:

1. Compare `artifact.version` with canonical source.
2. Reject stale reviews instead of overwriting newer work.
3. Validate or test the proposed result.
4. Save or commit through the host's normal permission boundary.
5. Return a new version token for the next review session.

For repository-backed artifacts, prefer creating a patch or worktree update
that remains reviewable rather than letting a browser request write directly to
the default branch.

## Add another harness

Implement one async function:

```js
async function adapter(reviewRequest) {
  const result = await harness.run(reviewRequest);
  return result.proposal;
}
```

Validate the returned proposal with `normalizeProposal()` or use the built-in
fetch adapter, which normalizes every successful response automatically.
