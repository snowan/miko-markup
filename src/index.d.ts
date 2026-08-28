export type ArtifactAnchor = {
  selector: string;
  tag: string;
  textQuote: { exact: string; prefix: string; suffix: string };
};

export type ReviewComment = {
  id: string;
  scope: "element" | "artifact";
  instruction: string;
  anchors: ArtifactAnchor[];
};

export type DirectEdit = {
  id: string;
  selector: string;
  operation: "setHTML";
  before: string;
  after: string;
};

export type ReviewRequest = {
  protocol: "miko-markup/1";
  requestId: string;
  artifact: { id: string; path?: string; version?: string };
  source: { html: string };
  review: {
    totalComments: number;
    anchoredComments: number;
    wholePageComments: number;
    includesWholePage: boolean;
  };
  feedback: ReviewComment[];
  directEdits: DirectEdit[];
};

export type ArtifactPatch =
  | { selector: string; operation: "setText"; value: string; commentId?: string }
  | { selector: string; operation: "setHTML"; value: string; commentId?: string }
  | { selector: string; operation: "setAttribute"; name: string; value: string; commentId?: string }
  | { selector: string; operation: "removeAttribute"; name: string; commentId?: string };

export type ArtifactProposal = { summary: string; patches: ArtifactPatch[] };

export type ArtifactReviewOptions = {
  root: string | Element;
  artifact?: { id?: string; path?: string; version?: string };
  adapter?: (request: ReviewRequest) => ArtifactProposal | Promise<ArtifactProposal>;
  preview?: (context: { root: Element; request: ReviewRequest; proposal: ArtifactProposal }) =>
    { commit?(): void; rollback?(): void } | Promise<{ commit?(): void; rollback?(): void }>;
  onApply?: (result: {
    artifact: object;
    html: string;
    innerHTML: string;
    proposal: ArtifactProposal | null;
    comments: ReviewComment[];
    directEdits: ReviewRequest["directEdits"];
  }) => void | Promise<void>;
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
};

export function createArtifactReview(options: ArtifactReviewOptions): {
  enable(): void;
  disable(): void;
  open(): void;
  close(): void;
  select(selector: string): void;
  commentWholeArtifact(): void;
  getRequest(): ReviewRequest;
  getState(): object;
  destroy(): void;
};

export function selectorFor(element: Element, root: Element): string;
export function createReviewRequest(input?: {
  artifact?: { id?: string; path?: string; version?: string };
  html?: string;
  comments?: ReviewComment[];
  directEdits?: DirectEdit[];
}): ReviewRequest;
export function normalizeProposal(input: object): ArtifactProposal;
export function previewProposal(root: Element, proposal: ArtifactProposal): {
  touched: Set<Element>;
  commit(): void;
  rollback(): void;
};
export function createFetchAdapter(options: {
  endpoint: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): (request: ReviewRequest) => Promise<ArtifactProposal>;
export const protocol: "miko-markup/1";
