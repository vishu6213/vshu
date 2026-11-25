import { OrchestrationError } from '../orchestration-error'

/** A call to a paired server that failed before its request left this Vshu. */
export class UnsentRequestError extends OrchestrationError {}
