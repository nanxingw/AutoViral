// ADR-009 — typed error for the shared composition-ops core.
//
// `code` is the protocol-level exit/HTTP class an op rejection maps to. Per
// PRD-0004 S3's error-code contract, input/validation rejections (clip not
// found, split point outside the clip, cross-kind move, …) carry `code: 4`.
// The bridge passes `.code` straight into the HTTP/JSON envelope (→ CLI exit
// 4); the store catches the throw and surfaces it as a toast / silent no-op.
export class CompositionOpError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "CompositionOpError";
  }
}
