const PROTOCOL = "miko-markup/1";
const INTERNAL_ATTRIBUTES = [
  "data-iar-hover",
  "data-iar-selected",
  "data-iar-preview",
  "data-iar-editing",
  "data-iar-keyboard",
  "data-iar-tabindex",
];
const SELECTABLE = [
  "[data-artifact-section]",
  "[data-artifact-id]",
  "[data-artifact-line-start]",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "figure",
  "nav",
  "h1",
  "h2",
  "h3",
  "p",
  "li",
  "pre",
  "blockquote",
].join(",");

let instanceCount = 0;

function uid(prefix) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function quoteAttribute(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function normalizeText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeSource(source, html = "") {
  if (source == null) return { html: String(html ?? "") };
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Artifact source must be an object with format and content strings.");
  }
  if (typeof source.format !== "string" || !source.format.trim()) {
    throw new TypeError("Artifact source needs a non-empty format string.");
  }
  if (typeof source.content !== "string") {
    throw new TypeError("Artifact source needs a content string.");
  }
  return { format: source.format.trim(), content: source.content };
}

function sourceRangeFor(element, root, source) {
  const carrier = element.closest?.("[data-artifact-line-start]");
  if (carrier && (carrier === root || root.contains(carrier))) {
    const startLine = Number.parseInt(carrier.getAttribute("data-artifact-line-start"), 10);
    const endLine = Number.parseInt(carrier.getAttribute("data-artifact-line-end") ?? String(startLine), 10);
    if (Number.isInteger(startLine) && startLine > 0 && Number.isInteger(endLine) && endLine >= startLine) {
      return { startLine, endLine };
    }
  }
  if (element === root && source?.format === "markdown") {
    return { startLine: 1, endLine: Math.max(1, source.content.split(/\r?\n/).length) };
  }
  return null;
}

function resolveRoot(root) {
  if (typeof root === "string") {
    const element = document.querySelector(root);
    if (!element) throw new Error(`MikoMarkup could not find root \"${root}\". Pass a selector that matches one element.`);
    return element;
  }
  if (root instanceof Element) return root;
  throw new TypeError("MikoMarkup needs a root Element or selector string.");
}

function selectorIsUnique(root, selector, element) {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/** Return a root-relative selector, preferring author-provided stable IDs. */
export function selectorFor(element, root) {
  if (!(element instanceof Element) || !(root instanceof Element)) {
    throw new TypeError("selectorFor needs an element and its root element.");
  }
  if (element === root) return ":scope";
  if (!root.contains(element)) throw new Error("The selected element is outside the artifact root.");

  const artifactId = element.getAttribute("data-artifact-id");
  if (artifactId) {
    const selector = `[data-artifact-id=\"${quoteAttribute(artifactId)}\"]`;
    if (selectorIsUnique(root, selector, element)) return selector;
  }

  if (element.id) {
    const selector = `#${cssEscape(element.id)}`;
    if (selectorIsUnique(root, selector, element)) return selector;
  }

  const segments = [];
  let current = element;
  while (current && current !== root) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter((candidate) => candidate.tagName === current.tagName)
      : [];
    const index = Math.max(1, siblings.indexOf(current) + 1);
    segments.unshift(`${tag}:nth-of-type(${index})`);
    const selector = `:scope > ${segments.join(" > ")}`;
    if (selectorIsUnique(root, selector, element)) return selector;
    current = current.parentElement;
  }
  return `:scope > ${segments.join(" > ")}`;
}

function anchorFor(element, root, source) {
  const exact = normalizeText(element.textContent).slice(0, 320);
  const parentText = normalizeText(element.parentElement?.textContent);
  const offset = exact ? parentText.indexOf(exact) : -1;
  const sourceRange = sourceRangeFor(element, root, source);
  return {
    selector: selectorFor(element, root),
    tag: element.tagName.toLowerCase(),
    textQuote: {
      exact,
      prefix: offset > 0 ? parentText.slice(Math.max(0, offset - 48), offset) : "",
      suffix: offset >= 0 ? parentText.slice(offset + exact.length, offset + exact.length + 48) : "",
    },
    ...(sourceRange ? { sourceRange } : {}),
  };
}

function cloneForSerialization(root) {
  const clone = root.cloneNode(true);
  const elements = [clone, ...clone.querySelectorAll("*")];
  for (const element of elements) {
    if (element.hasAttribute("data-iar-tabindex")) element.removeAttribute("tabindex");
    for (const attribute of INTERNAL_ATTRIBUTES) element.removeAttribute(attribute);
  }
  return clone;
}

function serializeRoot(root) {
  return cloneForSerialization(root).outerHTML;
}

function serializeInnerRoot(root) {
  return cloneForSerialization(root).innerHTML;
}

/** Create the portable request passed to every agent adapter. */
export function createReviewRequest({ artifact = {}, html = "", source, comments = [], directEdits = [] } = {}) {
  const wholePageComments = comments.filter((comment) => comment.scope === "artifact").length;
  return {
    protocol: PROTOCOL,
    requestId: uid("review"),
    artifact: {
      id: artifact.id ?? "artifact",
      ...(artifact.path ? { path: artifact.path } : {}),
      ...(artifact.version ? { version: artifact.version } : {}),
    },
    source: normalizeSource(source, html),
    review: {
      totalComments: comments.length,
      anchoredComments: comments.length - wholePageComments,
      wholePageComments,
      includesWholePage: wholePageComments > 0,
    },
    feedback: comments.map((comment) => ({
      id: comment.id,
      scope: comment.scope,
      instruction: comment.instruction,
      anchors: comment.anchors ?? [],
    })),
    directEdits: directEdits.map(({ id, selector, before, after }) => ({
      id,
      selector,
      operation: "setHTML",
      before,
      after,
    })),
  };
}

const OPERATION_ALIASES = new Map([
  ["setText", "setText"],
  ["set-text", "setText"],
  ["replaceText", "setText"],
  ["replace-text", "setText"],
  ["setHTML", "setHTML"],
  ["set-html", "setHTML"],
  ["replaceInnerHTML", "setHTML"],
  ["replace-inner-html", "setHTML"],
  ["setAttribute", "setAttribute"],
  ["set-attribute", "setAttribute"],
  ["removeAttribute", "removeAttribute"],
  ["remove-attribute", "removeAttribute"],
  ["replaceSource", "replaceSource"],
  ["replace-source", "replaceSource"],
  ["replaceDocument", "replaceSource"],
  ["replace-document", "replaceSource"],
]);

/** Validate and normalize the deliberately small v1 patch contract. */
export function normalizeProposal(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("The agent adapter returned no proposal object.");
  }
  const sourcePatches = input.patches ?? input.changes;
  if (!Array.isArray(sourcePatches) || sourcePatches.length === 0) {
    throw new Error("The agent proposal has no patches. Return a non-empty patches array.");
  }

  const patches = sourcePatches.map((patch, index) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new TypeError(`Patch ${index + 1} must be an object.`);
    }
    const operation = OPERATION_ALIASES.get(patch.operation ?? patch.op);
    if (!operation) {
      throw new Error(`Patch ${index + 1} uses an unsupported operation. Use setText, setHTML, setAttribute, removeAttribute, or replaceSource.`);
    }
    const value = patch.value ?? patch.text ?? patch.html ?? patch.content ?? patch.markdown;
    if (operation === "replaceSource") {
      if (typeof patch.format !== "string" || !patch.format.trim()) {
        throw new Error(`Patch ${index + 1} needs a source format.`);
      }
      if (typeof value !== "string") {
        throw new Error(`Patch ${index + 1} needs a source content string.`);
      }
      return {
        operation,
        format: patch.format.trim(),
        value,
        ...(patch.commentId ? { commentId: patch.commentId } : {}),
      };
    }
    if (typeof patch.selector !== "string" || !patch.selector.trim()) {
      throw new Error(`Patch ${index + 1} has no selector.`);
    }
    if ((operation === "setText" || operation === "setHTML") && typeof value !== "string") {
      throw new Error(`Patch ${index + 1} needs a string value.`);
    }
    if ((operation === "setAttribute" || operation === "removeAttribute") && typeof patch.name !== "string") {
      throw new Error(`Patch ${index + 1} needs an attribute name.`);
    }
    if ((operation === "setAttribute" || operation === "removeAttribute") && !validateAttribute(patch.name)) {
      throw new Error(`Patch ${index + 1} cannot change "${patch.name}". Use class, title, alt, aria-*, or non-internal data-* attributes.`);
    }

    return {
      selector: patch.selector.trim(),
      operation,
      ...(operation === "setText" ? { value } : {}),
      ...(operation === "setHTML" ? { value } : {}),
      ...(operation === "setAttribute" ? { name: patch.name, value: String(patch.value ?? "") } : {}),
      ...(operation === "removeAttribute" ? { name: patch.name } : {}),
      ...(patch.commentId ? { commentId: patch.commentId } : {}),
    };
  });

  return {
    summary: typeof input.summary === "string" ? input.summary : `Prepared ${patches.length} update${patches.length === 1 ? "" : "s"}.`,
    patches,
  };
}

/** Connect the review layer to any HTTP endpoint with the same JSON contract. */
export function createFetchAdapter({ endpoint, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  if (!endpoint) throw new Error("createFetchAdapter needs an endpoint.");
  if (typeof fetchImpl !== "function") throw new Error("createFetchAdapter needs a fetch implementation.");

  return async function fetchAdapter(request) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const details = (await response.text()).trim();
      throw new Error(`The agent endpoint ${endpoint} returned HTTP ${response.status}${details ? `: ${details}` : "."}`);
    }
    return normalizeProposal(await response.json());
  };
}

const URL_ATTRIBUTES = new Set(["href", "src", "srcset", "xlink:href", "action", "formaction", "poster"]);

function hasUnsafeUrl(value) {
  const compact = String(value).replace(/[\u0000-\u0020\u007f-\u009f]/g, "").toLowerCase();
  if (compact.includes("javascript:") || compact.includes("vbscript:")) return true;
  if (!compact.includes("data:")) return false;
  return !/^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/=]+$/i.test(compact);
}

function sanitizeFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style,iframe,object,embed,link,meta,base,form,foreignObject").forEach((element) => element.remove());
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "style" || (URL_ATTRIBUTES.has(name) && hasUnsafeUrl(attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return template.innerHTML;
}

function validateAttribute(name) {
  const normalized = name.toLowerCase();
  if (normalized.startsWith("data-iar-")) return false;
  return normalized === "class" || normalized === "title" || normalized === "alt" || normalized.startsWith("aria-") || normalized.startsWith("data-");
}

function targetFor(root, selector) {
  if (selector === ":scope") return root;
  try {
    return root.querySelector(selector);
  } catch {
    throw new Error(`The agent returned an invalid selector: ${selector}`);
  }
}

/** Apply a proposal to the current DOM and return an idempotent preview handle. */
export function previewProposal(root, input) {
  if (!(root instanceof Element)) throw new TypeError("previewProposal needs an artifact root Element.");
  const proposal = normalizeProposal(input);
  if (proposal.patches.some((patch) => patch.operation === "replaceSource")) {
    throw new Error("replaceSource patches need previewSourceProposal() or createMarkdownArtifactReview().");
  }
  const reversals = [];
  const touched = new Set();
  try {
    for (const [index, patch] of proposal.patches.entries()) {
      const target = targetFor(root, patch.selector);
      if (!target) throw new Error(`Patch ${index + 1} did not match \"${patch.selector}\" in the current artifact.`);
      touched.add(target);

      if (patch.operation === "setText") {
        const before = target.textContent;
        target.textContent = patch.value;
        reversals.push(() => { target.textContent = before; });
      } else if (patch.operation === "setHTML") {
        const before = target.innerHTML;
        target.innerHTML = sanitizeFragment(patch.value);
        reversals.push(() => { target.innerHTML = before; });
      } else if (patch.operation === "setAttribute") {
        if (!validateAttribute(patch.name)) {
          throw new Error(`Patch ${index + 1} cannot set \"${patch.name}\". v1 only previews class, title, alt, aria-*, and data-* attributes.`);
        }
        const hadAttribute = target.hasAttribute(patch.name);
        const before = target.getAttribute(patch.name);
        target.setAttribute(patch.name, patch.value);
        reversals.push(() => hadAttribute ? target.setAttribute(patch.name, before) : target.removeAttribute(patch.name));
      } else if (patch.operation === "removeAttribute") {
        if (!validateAttribute(patch.name)) {
          throw new Error(`Patch ${index + 1} cannot remove \"${patch.name}\". v1 only previews class, title, alt, aria-*, and data-* attributes.`);
        }
        const hadAttribute = target.hasAttribute(patch.name);
        const before = target.getAttribute(patch.name);
        target.removeAttribute(patch.name);
        reversals.push(() => { if (hadAttribute) target.setAttribute(patch.name, before); });
      }
    }
  } catch (error) {
    [...reversals].reverse().forEach((reverse) => reverse());
    throw error;
  }

  touched.forEach((element) => element.setAttribute("data-iar-preview", ""));
  let settled = false;
  return {
    touched,
    rollback() {
      if (settled) return;
      settled = true;
      [...reversals].reverse().forEach((reverse) => reverse());
      touched.forEach((element) => element.removeAttribute("data-iar-preview"));
    },
    commit() {
      if (settled) return;
      settled = true;
      touched.forEach((element) => element.removeAttribute("data-iar-preview"));
    },
  };
}

/** Render and preview one complete source replacement without persisting it. */
export async function previewSourceProposal(root, input, { format, render } = {}) {
  if (!(root instanceof Element)) throw new TypeError("previewSourceProposal needs an artifact root Element.");
  if (typeof render !== "function") throw new TypeError("previewSourceProposal needs a render(content) function.");
  const proposal = normalizeProposal(input);
  const replacements = proposal.patches.filter((patch) => patch.operation === "replaceSource");
  if (replacements.length !== 1 || proposal.patches.length !== 1) {
    throw new Error("A source preview needs exactly one replaceSource patch and no DOM patches.");
  }
  const patch = replacements[0];
  if (format && patch.format !== format) {
    throw new Error(`The agent returned ${patch.format} source for a ${format} artifact.`);
  }

  const rendered = await render(patch.value, { format: patch.format, proposal });
  if (typeof rendered !== "string") {
    throw new TypeError("The source renderer must return an HTML string.");
  }

  const before = serializeInnerRoot(root);
  root.innerHTML = sanitizeFragment(rendered);
  root.setAttribute("data-iar-preview", "");
  let settled = false;
  return {
    touched: new Set([root]),
    source: { format: patch.format, content: patch.value },
    rollback() {
      if (settled) return;
      settled = true;
      root.innerHTML = before;
      root.removeAttribute("data-iar-preview");
    },
    commit() {
      if (settled) return;
      settled = true;
      root.removeAttribute("data-iar-preview");
    },
  };
}

function installPageStyles(id) {
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    [data-iar-hover] { outline: 2px dashed #275ccf !important; outline-offset: 4px !important; cursor: crosshair !important; }
    [data-iar-selected] { outline: 3px solid #275ccf !important; outline-offset: 4px !important; }
    [data-iar-preview] { outline: 3px solid #df5b35 !important; outline-offset: 4px !important; }
    [data-iar-editing] { outline: 3px solid #18805a !important; outline-offset: 4px !important; cursor: text !important; }
    [data-iar-keyboard]:focus-visible { outline: 3px dashed #275ccf !important; outline-offset: 4px !important; }
  `;
  document.head.append(style);
  return style;
}

const panelStyles = `
  :host { color-scheme: light; --ink:#172335; --muted:#667085; --line:#d8d3c7; --paper:#fffdf7; --soft:#f1eee6; --blue:#275ccf; --orange:#df5b35; font: 16px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  button, textarea { font: inherit; }
  button { border: 1px solid var(--line); background: var(--paper); color: var(--ink); border-radius: 10px; min-height: 42px; padding: 9px 12px; cursor: pointer; font-weight: 700; }
  button:hover { border-color: #9aa7bd; }
  button:focus-visible, textarea:focus-visible { outline: 3px solid rgba(39,92,207,.3); outline-offset: 2px; }
  button:disabled { cursor: not-allowed; opacity: .52; }
  .launcher { position: fixed; z-index: 2147483645; right: 20px; bottom: 20px; border: 0; background: var(--ink); color: white; box-shadow: 0 12px 36px rgba(23,35,53,.25); padding-inline: 18px; }
  .panel { position: fixed; z-index: 2147483644; top: 16px; right: 16px; bottom: 16px; width: min(390px, calc(100vw - 32px)); display:flex; flex-direction:column; overflow:hidden; background: var(--paper); border:1px solid var(--line); border-radius:16px; box-shadow:0 24px 80px rgba(23,35,53,.24); color:var(--ink); }
  .head { display:flex; justify-content:space-between; gap:16px; align-items:start; padding:18px 18px 14px; border-bottom:1px solid var(--line); }
  h2 { margin:0; font: 700 21px/1.2 ui-serif, Georgia, serif; letter-spacing:-.01em; }
  .sub { margin:5px 0 0; color:var(--muted); font-size:14px; }
  .close { border:0; min-height:34px; width:34px; padding:0; background:transparent; font-size:22px; }
  .body { overflow:auto; padding:16px 18px 22px; }
  .label { display:block; margin:0 0 7px; font-size:13px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#475467; }
  .selection { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 12px; background:var(--soft); border-radius:10px; color:#475467; font-size:14px; }
  .selection strong { color:var(--ink); }
  .selection-copy { min-width:0; }
  .context-action { flex:0 0 auto; min-height:30px; padding:2px 0; border:0; border-radius:4px; background:transparent; color:var(--blue); font-size:13px; white-space:nowrap; }
  .context-action:hover { border-color:transparent; text-decoration:underline; }
  textarea { width:100%; min-height:104px; resize:vertical; padding:12px; color:var(--ink); background:white; border:1px solid var(--line); border-radius:10px; }
  .section { padding-top:18px; }
  .row { display:flex; gap:8px; align-items:center; }
  .row > * { flex:1; }
  .primary { border-color:var(--blue); background:var(--blue); color:white; }
  .primary:hover { border-color:#173f9b; }
  .orange { border-color:var(--orange); background:var(--orange); color:white; }
  .quiet { background:transparent; }
  .comment { margin-top:9px; padding:12px; border:1px solid var(--line); border-radius:11px; background:white; }
  .comment-head { display:flex; justify-content:space-between; gap:12px; align-items:center; }
  .comment-location { overflow:hidden; color:#275ccf; font-size:13px; font-weight:800; text-overflow:ellipsis; white-space:nowrap; }
  .comment p { margin:7px 0 0; color:#344054; }
  .remove { flex:0 0 auto; min-height:30px; width:30px; padding:0; border:0; background:transparent; color:#667085; }
  .empty { margin:8px 0 0; color:var(--muted); font-size:14px; }
  .status { margin-top:14px; padding:11px 12px; border-radius:10px; background:#eaf6ef; color:#155b40; font-size:14px; }
  .status.error { background:#fff0ed; color:#9e2f19; }
  .proposal { margin-top:17px; padding:14px; border:1px solid #efb8a6; background:#fff5f1; border-radius:12px; }
  .proposal strong { display:block; margin-bottom:4px; }
  .proposal p { margin:0; color:#7d3422; }
  .footer { margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
  .batch { margin:0 0 9px; color:var(--muted); font-size:14px; text-align:center; }
  .editing { position:fixed; z-index:2147483646; left:50%; bottom:20px; transform:translateX(-50%); display:flex; gap:8px; align-items:center; padding:10px; border:1px solid var(--line); border-radius:13px; background:var(--paper); box-shadow:0 16px 50px rgba(23,35,53,.24); }
  .editing span { padding:0 6px; font-weight:700; white-space:nowrap; }
  .editing button { min-height:38px; }
  @media (max-width: 620px) {
    .panel { top:auto; right:8px; bottom:8px; left:8px; width:auto; max-height:76vh; border-radius:16px; }
    .launcher { right:12px; bottom:12px; }
    .selection { align-items:flex-start; flex-direction:column; gap:5px; }
    .context-action { text-align:left; white-space:normal; }
    .editing { left:8px; right:8px; bottom:8px; transform:none; flex-wrap:wrap; }
    .editing span { width:100%; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .panel { animation:iar-in .16s ease-out; }
    @keyframes iar-in { from { opacity:0; transform:translateX(8px); } }
  }
`;

function commentLocation(comment) {
  if (comment.scope === "artifact") return "Whole page";
  const anchor = comment.anchors?.[0];
  if (!anchor) return "Selected section";
  const exact = normalizeText(anchor.textQuote?.exact);
  const quote = exact.slice(0, 52);
  if (anchor.sourceRange) {
    const { startLine, endLine } = anchor.sourceRange;
    const lines = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
    return `${lines}${quote ? ` · ${quote}${exact.length > 52 ? "…" : ""}` : ""}`;
  }
  return `${anchor.tag}${quote ? ` · ${quote}${exact.length > 52 ? "…" : ""}` : ""}`;
}

function selectedSummary(state) {
  if (state.commentTarget === "artifact") {
    return `<span class="selection-copy"><strong>Whole page</strong> · This comment applies everywhere.</span><button class="context-action" data-action="choose-section">Choose a section</button>`;
  }
  if (state.selected.length === 0) {
    return `<span class="selection-copy">Click any section to place a comment.</span><button class="context-action" data-action="whole-page">Comment on whole page</button>`;
  }
  const element = state.selected[0];
  const exact = normalizeText(element.textContent);
  const text = exact.slice(0, 58);
  return `<span class="selection-copy"><strong>${escapeHtml(element.tagName.toLowerCase())}</strong>${text ? ` · ${escapeHtml(text)}${exact.length > 58 ? "…" : ""}` : ""}</span><button class="context-action" data-action="whole-page">Comment on whole page</button>`;
}

/** Mount a zero-dependency inline review layer over an existing rendered artifact. */
export function createArtifactReview(options = {}) {
  const root = resolveRoot(options.root);
  const allowInlineEdit = options.allowInlineEdit ?? options.source == null;
  if (options.source != null && typeof options.source !== "function") normalizeSource(options.source);
  const instanceId = `iar-${++instanceCount}`;
  const style = installPageStyles(`${instanceId}-style`);
  const host = document.createElement("div");
  host.dataset.mikoMarkup = instanceId;
  const shadow = host.attachShadow({ mode: "open" });
  document.body.append(host);
  const keyboardTargets = new Set();

  const state = {
    open: false,
    enabled: false,
    commentTarget: "element",
    selected: [],
    comments: [],
    directEdits: [],
    draft: "",
    busy: false,
    status: "",
    error: "",
    proposal: null,
    preview: null,
    request: null,
    editing: null,
  };

  function currentSource() {
    const source = typeof options.source === "function" ? options.source() : options.source;
    return source == null ? null : normalizeSource(source);
  }

  const emit = (type, detail = {}) => {
    options.onEvent?.({ type, ...detail });
    host.dispatchEvent(new CustomEvent(`artifact-review:${type}`, { detail }));
  };

  function clearMarkers() {
    root.querySelectorAll("[data-iar-hover]").forEach((element) => element.removeAttribute("data-iar-hover"));
    root.querySelectorAll("[data-iar-selected]").forEach((element) => element.removeAttribute("data-iar-selected"));
  }

  function enableKeyboardSelection() {
    root.querySelectorAll("[data-artifact-section], [data-artifact-id], [data-artifact-line-start]").forEach((element) => {
      if (keyboardTargets.has(element)) return;
      keyboardTargets.add(element);
      element.setAttribute("data-iar-keyboard", "");
      if (!element.hasAttribute("tabindex")) {
        element.setAttribute("tabindex", "0");
        element.setAttribute("data-iar-tabindex", "");
      }
    });
  }

  function disableKeyboardSelection() {
    keyboardTargets.forEach((element) => {
      element.removeAttribute("data-iar-keyboard");
      if (element.hasAttribute("data-iar-tabindex")) {
        element.removeAttribute("tabindex");
        element.removeAttribute("data-iar-tabindex");
      }
    });
    keyboardTargets.clear();
  }

  function refreshKeyboardSelection() {
    if (!state.enabled) return;
    disableKeyboardSelection();
    enableKeyboardSelection();
  }

  function clearSelection({ shouldRender = true } = {}) {
    state.selected.forEach((element) => element.removeAttribute("data-iar-selected"));
    state.selected = [];
    if (shouldRender) render();
  }

  function chooseWholePage() {
    state.commentTarget = "artifact";
    clearSelection({ shouldRender: false });
    state.status = "";
    state.error = "";
    render();
  }

  function chooseSection() {
    state.commentTarget = "element";
    state.status = "";
    state.error = "";
    render();
  }

  function resolveSelectable(target) {
    if (!(target instanceof Element) || !root.contains(target)) return null;
    if (target === root) return root;
    const candidate = target.closest(SELECTABLE);
    return candidate && root.contains(candidate) ? candidate : target;
  }

  function selectElement(element) {
    state.selected.forEach((selected) => selected.removeAttribute("data-iar-selected"));
    state.selected = [element];
    state.commentTarget = "element";
    element.setAttribute("data-iar-selected", "");
    state.open = true;
    state.error = "";
    emit("select", { target: "element", anchors: [anchorFor(element, root, currentSource())] });
    render();
  }

  function handlePointerOver(event) {
    if (!state.enabled || state.editing) return;
    const element = resolveSelectable(event.target);
    if (element && !element.hasAttribute("data-iar-selected")) element.setAttribute("data-iar-hover", "");
  }

  function handlePointerOut(event) {
    if (!(event.target instanceof Element)) return;
    event.target.closest("[data-iar-hover]")?.removeAttribute("data-iar-hover");
  }

  function handleClick(event) {
    if (!state.enabled || state.editing) return;
    const element = resolveSelectable(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    root.querySelectorAll("[data-iar-hover]").forEach((hovered) => hovered.removeAttribute("data-iar-hover"));
    selectElement(element);
  }

  function handleKeydown(event) {
    if (state.editing) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelInlineEdit();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        saveInlineEdit();
      }
      return;
    }
    if (state.enabled && (event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.hasAttribute("data-iar-keyboard")) {
      event.preventDefault();
      selectElement(event.target);
      return;
    }
    if (event.key === "Escape" && state.enabled) clearSelection();
  }

  root.addEventListener("pointerover", handlePointerOver, true);
  root.addEventListener("pointerout", handlePointerOut, true);
  root.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeydown, true);

  function addComment() {
    const instruction = state.draft.trim();
    if (!instruction) {
      state.error = "Write a comment before adding it.";
      render();
      return;
    }
    if (state.commentTarget !== "artifact" && state.selected.length === 0) {
      state.error = "Select a section, or choose Comment on whole page.";
      render();
      return;
    }

    const isWholePage = state.commentTarget === "artifact";
    const source = currentSource();
    const comment = {
      id: uid("comment"),
      scope: isWholePage ? "artifact" : "element",
      instruction,
      anchors: isWholePage ? [anchorFor(root, root, source)] : [anchorFor(state.selected[0], root, source)],
    };
    state.comments.push(comment);
    state.draft = "";
    state.error = "";
    state.status = "Comment added. Click another section, add a whole-page comment, or send the batch.";
    state.commentTarget = "element";
    clearSelection({ shouldRender: false });
    emit("comment", { comment });
    render();
  }

  function startInlineEdit() {
    if (!allowInlineEdit) {
      state.error = "Inline DOM editing is unavailable for this source-backed artifact. Add a comment and let the agent update its source.";
      render();
      return;
    }
    if (state.selected.length !== 1 || state.commentTarget === "artifact") {
      state.error = "Choose one element before editing its text.";
      render();
      return;
    }
    const element = state.selected[0];
    state.editing = {
      element,
      selector: selectorFor(element, root),
      before: element.innerHTML,
      previousContenteditable: element.getAttribute("contenteditable"),
    };
    element.setAttribute("contenteditable", "true");
    element.setAttribute("data-iar-editing", "");
    element.removeAttribute("data-iar-selected");
    element.focus({ preventScroll: true });
    emit("edit-start", { selector: state.editing.selector });
    render();
  }

  function finishEditingAttributes(editing) {
    editing.element.removeAttribute("data-iar-editing");
    if (editing.previousContenteditable === null) editing.element.removeAttribute("contenteditable");
    else editing.element.setAttribute("contenteditable", editing.previousContenteditable);
    editing.element.setAttribute("data-iar-selected", "");
  }

  function cancelInlineEdit() {
    if (!state.editing) return;
    const editing = state.editing;
    editing.element.innerHTML = editing.before;
    finishEditingAttributes(editing);
    state.editing = null;
    state.status = "Inline edit canceled.";
    emit("edit-cancel", { selector: editing.selector });
    render();
  }

  function saveInlineEdit() {
    if (!state.editing) return;
    const editing = state.editing;
    const after = sanitizeFragment(editing.element.innerHTML);
    editing.element.innerHTML = after;
    finishEditingAttributes(editing);
    state.editing = null;
    if (editing.before !== after) {
      const edit = { id: uid("edit"), selector: editing.selector, operation: "setHTML", before: editing.before, after };
      state.directEdits.push(edit);
      state.status = "Inline edit is ready to save.";
      emit("edit", { edit });
    } else {
      state.status = "No text changed.";
    }
    render();
  }

  function buildRequest() {
    const source = currentSource();
    return createReviewRequest({
      artifact: options.artifact,
      ...(source ? { source } : { html: serializeRoot(root) }),
      comments: state.comments,
      directEdits: state.directEdits,
    });
  }

  async function sendToAgent() {
    if (state.comments.length === 0) {
      state.error = "Add at least one comment before sending to an agent.";
      render();
      return;
    }
    if (typeof options.adapter !== "function") {
      state.error = "No agent adapter is connected. Pass adapter() when you create the review layer.";
      render();
      return;
    }
    if (state.preview) state.preview.rollback();
    state.preview = null;
    state.proposal = null;
    state.busy = true;
    state.error = "";
    state.status = "Sending comments to the agent…";
    render();

    const request = buildRequest();
    state.request = request;
    emit("send", { request });
    try {
      const proposal = normalizeProposal(await options.adapter(request));
      const preview = typeof options.preview === "function"
        ? await options.preview({ root, request, proposal })
        : previewProposal(root, proposal);
      state.proposal = proposal;
      state.preview = preview ?? { commit() {}, rollback() {} };
      state.status = "";
      refreshKeyboardSelection();
      emit("preview", { request, proposal });
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = "";
      state.request = null;
      emit("error", { error });
    } finally {
      state.busy = false;
      render();
    }
  }

  async function applyUpdate() {
    if (!state.proposal || !state.preview) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      const appliedSource = state.preview.source;
      const payload = {
        artifact: options.artifact ?? { id: "artifact" },
        html: serializeRoot(root),
        innerHTML: serializeInnerRoot(root),
        proposal: state.proposal,
        ...(appliedSource ? { source: appliedSource } : {}),
        comments: [...state.comments],
        directEdits: [...state.directEdits],
      };
      await options.onApply?.(payload);
      state.preview.commit?.();
      state.comments = [];
      state.directEdits = [];
      state.proposal = null;
      state.preview = null;
      state.request = null;
      state.status = typeof options.onApply === "function" ? "Update saved." : "Update applied to this page.";
      refreshKeyboardSelection();
      emit("apply", payload);
    } catch (error) {
      state.error = `The preview changed, but the host could not save it: ${error instanceof Error ? error.message : String(error)}`;
      emit("error", { error });
    } finally {
      state.busy = false;
      render();
    }
  }

  function discardUpdate() {
    state.preview?.rollback?.();
    state.proposal = null;
    state.preview = null;
    state.request = null;
    state.status = "Agent proposal discarded. Your comments are still here.";
    refreshKeyboardSelection();
    emit("discard");
    render();
  }

  async function saveDirectEdits() {
    if (state.directEdits.length === 0) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      const payload = {
        artifact: options.artifact ?? { id: "artifact" },
        html: serializeRoot(root),
        innerHTML: serializeInnerRoot(root),
        proposal: null,
        comments: [],
        directEdits: [...state.directEdits],
      };
      await options.onApply?.(payload);
      state.directEdits = [];
      state.status = typeof options.onApply === "function" ? "Inline update saved." : "Inline update applied to this page.";
      emit("apply", payload);
    } catch (error) {
      state.error = `The inline edit is visible, but the host could not save it: ${error instanceof Error ? error.message : String(error)}`;
      emit("error", { error });
    } finally {
      state.busy = false;
      render();
    }
  }

  function render() {
    const wholePageComments = state.comments.filter((comment) => comment.scope === "artifact").length;
    const comments = state.comments.map((comment, index) => `
      <div class="comment">
        <div class="comment-head">
          <span class="comment-location">${index + 1}. ${escapeHtml(commentLocation(comment))}</span>
          <button class="remove" data-action="remove-comment" data-id="${escapeHtml(comment.id)}" aria-label="Remove comment ${index + 1}" ${state.busy || state.proposal ? "disabled" : ""}>×</button>
        </div>
        <p>${escapeHtml(comment.instruction)}</p>
      </div>
    `).join("");

    shadow.innerHTML = `<style>${panelStyles}</style>
      ${state.open ? `
        <aside class="panel" aria-label="Inline artifact review">
          <div class="head">
            <div><h2>Review this artifact</h2><p class="sub">Click, comment, repeat. Send when ready.</p></div>
            <button class="close" data-action="close" aria-label="Close review panel">×</button>
          </div>
          <div class="body">
            <div class="selection" aria-live="polite">${selectedSummary(state)}</div>

            <div class="section">
              <label class="label" for="iar-comment">Comment</label>
              <textarea id="iar-comment" placeholder="What should the agent change?">${escapeHtml(state.draft)}</textarea>
              <div class="row" style="margin-top:8px">
                ${allowInlineEdit ? `<button data-action="edit" ${state.commentTarget === "artifact" || state.selected.length !== 1 || state.busy || state.proposal ? "disabled" : ""}>Edit inline</button>` : ""}
                <button class="primary" data-action="add-comment" ${state.busy || state.proposal ? "disabled" : ""}>Add comment</button>
              </div>
            </div>

            <div class="section">
              <span class="label">Comments ready (${state.comments.length})</span>
              ${comments || `<p class="empty">Add comments one section at a time, or comment on the whole page.</p>`}
            </div>

            ${state.status ? `<div class="status" role="status">${escapeHtml(state.status)}</div>` : ""}
            ${state.error ? `<div class="status error" role="alert">${escapeHtml(state.error)}</div>` : ""}

            ${state.proposal ? `
              <div class="proposal">
                <strong>Agent preview</strong>
                <p>${escapeHtml(state.proposal.summary)}</p>
              </div>
              <div class="row" style="margin-top:10px">
                <button data-action="discard" ${state.busy ? "disabled" : ""}>Discard</button>
                <button class="orange" data-action="apply" ${state.busy ? "disabled" : ""}>Apply update</button>
              </div>
            ` : `
              <div class="footer">
                ${state.comments.length ? `<p class="batch">${state.comments.length} comment${state.comments.length === 1 ? "" : "s"} ready${wholePageComments ? ` · ${wholePageComments} for whole page` : ""}</p><button class="orange" style="width:100%" data-action="send" ${state.busy ? "disabled" : ""}>${state.busy ? "Waiting for agent…" : `Send ${state.comments.length} comment${state.comments.length === 1 ? "" : "s"} to agent`}</button>` : ""}
                ${state.directEdits.length ? `<button class="primary" style="width:100%;margin-top:${state.comments.length ? "8" : "0"}px" data-action="save-direct" ${state.busy ? "disabled" : ""}>Save ${state.directEdits.length} inline edit${state.directEdits.length === 1 ? "" : "s"}</button>` : ""}
              </div>
            `}
          </div>
        </aside>
      ` : `<button class="launcher" data-action="open">Review</button>`}

      ${state.editing ? `
        <div class="editing" role="dialog" aria-label="Inline text editor">
          <span>Edit directly in the page</span>
          <button data-action="cancel-edit">Cancel</button>
          <button class="primary" data-action="save-edit">Save text</button>
        </div>
      ` : ""}
    `;
  }

  shadow.addEventListener("input", (event) => {
    if (event.target instanceof HTMLTextAreaElement) state.draft = event.target.value;
  });

  shadow.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "open") { state.open = true; state.enabled = true; enableKeyboardSelection(); render(); emit("enable"); }
    else if (action === "close") { state.open = false; state.enabled = false; clearMarkers(); disableKeyboardSelection(); render(); emit("disable"); }
    else if (action === "whole-page") chooseWholePage();
    else if (action === "choose-section") chooseSection();
    else if (action === "add-comment") addComment();
    else if (action === "edit") startInlineEdit();
    else if (action === "save-edit") saveInlineEdit();
    else if (action === "cancel-edit") cancelInlineEdit();
    else if (action === "send") sendToAgent();
    else if (action === "apply") applyUpdate();
    else if (action === "discard") discardUpdate();
    else if (action === "save-direct") saveDirectEdits();
    else if (action === "remove-comment") {
      state.comments = state.comments.filter((comment) => comment.id !== button.dataset.id);
      render();
    }
  });

  render();

  return {
    enable() { state.enabled = true; state.open = true; enableKeyboardSelection(); render(); emit("enable"); },
    disable() { state.enabled = false; state.open = false; clearMarkers(); disableKeyboardSelection(); render(); emit("disable"); },
    open() { state.open = true; render(); },
    close() { state.open = false; state.enabled = false; clearMarkers(); disableKeyboardSelection(); render(); emit("disable"); },
    select(selector) {
      const element = targetFor(root, selector);
      if (!element) throw new Error(`Could not select \"${selector}\" in the artifact.`);
      selectElement(element);
    },
    commentWholeArtifact() { chooseWholePage(); state.open = true; render(); },
    getRequest: buildRequest,
    getState() {
      return {
        enabled: state.enabled,
        commentTarget: state.commentTarget,
        selected: state.selected.map((element) => anchorFor(element, root, currentSource())),
        comments: structuredClone(state.comments),
        directEdits: structuredClone(state.directEdits),
        proposal: state.proposal ? structuredClone(state.proposal) : null,
      };
    },
    destroy() {
      if (state.preview) state.preview.rollback();
      if (state.editing) cancelInlineEdit();
      clearMarkers();
      disableKeyboardSelection();
      root.removeEventListener("pointerover", handlePointerOver, true);
      root.removeEventListener("pointerout", handlePointerOut, true);
      root.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeydown, true);
      style.remove();
      host.remove();
      emit("destroy");
    },
  };
}

/** Review rendered Markdown while preserving Markdown as the canonical source. */
export function createMarkdownArtifactReview(options = {}) {
  const {
    markdown,
    render,
    onApply,
    source: _source,
    preview: _preview,
    allowInlineEdit: _allowInlineEdit,
    ...reviewOptions
  } = options;
  if (typeof markdown !== "string") throw new TypeError("createMarkdownArtifactReview needs a markdown string.");
  if (typeof render !== "function") throw new TypeError("createMarkdownArtifactReview needs a render(markdown) function.");

  let currentMarkdown = markdown;
  const review = createArtifactReview({
    ...reviewOptions,
    source: () => ({ format: "markdown", content: currentMarkdown }),
    allowInlineEdit: false,
    preview: async ({ root, proposal }) => {
      const handle = await previewSourceProposal(root, proposal, { format: "markdown", render });
      return {
        touched: handle.touched,
        source: handle.source,
        rollback() { handle.rollback(); },
        commit() {
          handle.commit();
          currentMarkdown = handle.source.content;
        },
      };
    },
    ...(typeof onApply === "function" ? {
      onApply: async (payload) => {
        if (payload.source?.format !== "markdown") {
          throw new Error("The Markdown preview did not return Markdown source.");
        }
        await onApply({ ...payload, markdown: payload.source.content });
      },
    } : {}),
  });

  return Object.assign(review, {
    getMarkdown() { return currentMarkdown; },
  });
}

export const protocol = PROTOCOL;
