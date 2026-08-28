# MikoMarkup protocol

This document is the canonical wire contract between the browser SDK and an
agent adapter. The protocol identifier is exported as `protocol` from the
browser package.

## Review request

```json
{
  "protocol": "miko-markup/1",
  "requestId": "review_123",
  "artifact": {
    "id": "report-42",
    "path": "artifacts/report-42.html",
    "version": "sha256:abc123"
  },
  "source": {
    "html": "<main id=\"artifact\">…</main>"
  },
  "review": {
    "totalComments": 2,
    "anchoredComments": 1,
    "wholePageComments": 1,
    "includesWholePage": true
  },
  "feedback": [
    {
      "id": "comment_1",
      "scope": "element",
      "instruction": "Make this heading shorter",
      "anchors": [
        {
          "selector": "[data-artifact-id=\"summary\"]",
          "tag": "section",
          "textQuote": {
            "exact": "Summary…",
            "prefix": "",
            "suffix": ""
          }
        }
      ]
    },
    {
      "id": "comment_2",
      "scope": "artifact",
      "instruction": "Use a warmer tone throughout",
      "anchors": [
        {
          "selector": ":scope",
          "tag": "main",
          "textQuote": {
            "exact": "…",
            "prefix": "",
            "suffix": ""
          }
        }
      ]
    }
  ],
  "directEdits": []
}
```

`artifact.version` is optional in the SDK but should be required by a
repository-backed host. The host decides what the token means and rejects a
request when canonical source has changed since the review began.

An element comment has `scope: "element"`. A whole-page comment has
`scope: "artifact"` and uses `:scope` as its anchor selector. Every comment is
included in one request, and the `review` summary lets an agent verify the
batch before working.

## Proposal response

```json
{
  "summary": "Shortened the summary heading.",
  "patches": [
    {
      "selector": "[data-artifact-id=\"summary\"] h2",
      "operation": "setText",
      "value": "What changed",
      "commentId": "comment_1"
    }
  ]
}
```

Supported operations:

| Operation | Required fields | Effect |
| --- | --- | --- |
| `setText` | `selector`, `value` | Replaces `textContent` |
| `setHTML` | `selector`, `value` | Replaces sanitized `innerHTML` |
| `setAttribute` | `selector`, `name`, `value` | Sets an allowed attribute |
| `removeAttribute` | `selector`, `name` | Removes an allowed attribute |

Allowed attributes are `class`, `title`, `alt`, `aria-*`, and non-internal
`data-*`. `data-iar-*` belongs to the SDK and is rejected.

The machine-readable proposal schema is
[`src/proposal.schema.json`](../src/proposal.schema.json).
The built-in CLI adapters use
[`src/agent-output.schema.json`](../src/agent-output.schema.json), a flattened
equivalent for agent runtimes that do not accept `oneOf`. Unused patch fields
are `null` in that raw model response and are removed during normalization.

## Failure behavior

- An empty proposal is rejected.
- An unsupported operation or attribute is rejected before preview.
- An invalid or unmatched selector fails the whole preview.
- If any patch fails, already-applied patches are rolled back.
- A preview can be committed or rolled back once; repeated settlement calls do
  nothing.
