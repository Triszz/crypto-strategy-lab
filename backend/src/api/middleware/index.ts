/**
 * Aggregated middleware re-exports for the API layer.
 *
 * - `notFoundHandler` MUST be registered just before the error handler.
 * - `errorHandler` MUST be the absolute last middleware in the chain.
 *
 * Both implementations live in `src/shared/errors/` because the error
 * model is a cross-cutting concern, shared by every module.
 */
export { notFoundHandler, errorHandler } from "../../shared/errors";