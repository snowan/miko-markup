# Contributing

Thanks for helping make inline artifact review easier to embed.

## Before opening a pull request

1. Keep the browser SDK harness-neutral.
2. Put agent-specific process code in the Node adapter entry point.
3. Preserve the review request and proposal contracts, or document a protocol
   version change.
4. Add focused tests for behavior changes.
5. Run:

   ```bash
   npm install
   npm run check
   npm run pack:check
   ```

For visual changes, also run the demo at desktop and mobile widths. Test the
complete select, comment, whole-page comment, send, preview, discard, inline
edit, and apply paths with both pointer and keyboard input.

## Pull requests

Keep changes narrow and explain the user-facing behavior. Include the tests you
ran and call out any behavior that still relies on host configuration.
