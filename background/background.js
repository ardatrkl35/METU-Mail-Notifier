/**
 * Service worker entry (JOB-P2-2): side-effect registration + test exports.
 * Implementation lives in sibling modules; keep this file within the line budget.
 */
import './registerListeners.js';

export { runMailCheck } from './mailCheck.js';
export { STORAGE_KEYS } from './storageSchema.js';
export { REASON, mapAuthUnknownProbeReasonToPublicReason } from './reasons.js';
