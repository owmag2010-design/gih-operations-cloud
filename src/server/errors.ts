/** Errors services throw. Server actions translate them into user-facing results. */

export class AccessDeniedError extends Error {
  constructor(public readonly permission?: string) {
    super("You do not have access to do that.");
    this.name = "AccessDeniedError";
  }
}

/** Also thrown when a record exists but is outside the caller's scope, so callers cannot probe for ids. */
export class NotFoundError extends Error {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class RateLimitedError extends Error {
  constructor(message = "Too many attempts. Please wait a few minutes and try again.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Map a thrown error to an ActionResult. Unknown errors are logged and hidden. */
export function toActionError(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (err instanceof ValidationError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
  if (
    err instanceof AccessDeniedError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    err instanceof RateLimitedError
  ) {
    return { ok: false, error: err.message };
  }
  console.error("[action] unexpected error", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}
