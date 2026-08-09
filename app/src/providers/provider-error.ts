/**
 * An error the product raised deliberately, with a message fit to show a person.
 *
 * ADR-0007 requires degradation to be *named*. A raw exception from a provider
 * SDK is not a name: "Cannot read properties of undefined (reading 'keys')"
 * tells a curator nothing and tells a developer nothing either, because by the
 * time it reaches the interface the stack is gone. Anything that is not a
 * ProviderError is logged with its stack and reported under a named state.
 */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The message to show, and the diagnosis to log. */
export function providerFailureMessage(error: unknown, fallback: string) {
  if (error instanceof ProviderError) return error.message;
  console.error("[goDiesel] provider failure:", error);
  return fallback;
}
