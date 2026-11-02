// Errors the reconciler throws. The codes are the Canva Bridge's own, so a host can pass them through.

export type ReconcileErrorCode =
    | "bad_request" | "stale_revision" | "validation_failed" | "unsupported_page" | "page_locked"
    | "font_unavailable" | "asset_failed" | "not_supported" | "canva_error";

export class ReconcileError extends Error {
    override readonly name = "ReconcileError";

    constructor(readonly code : ReconcileErrorCode, message : string, readonly details? : unknown) {
        super(message);
    }
}

export const reconcileError = (code : ReconcileErrorCode, message : string, details? : unknown) => new ReconcileError(code, message, details);

export const isReconcileError = (x : unknown) : x is ReconcileError => x instanceof ReconcileError;
