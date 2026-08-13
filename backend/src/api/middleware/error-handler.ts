import { errorHandler } from "../../shared/errors";

/**
 * Re-exports the global error middleware. Registered LAST in the
 * Express middleware chain.
 */
export { errorHandler };