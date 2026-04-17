import { workerState } from './workerState.js';

export function makeGenerationGuard(capturedGeneration) {
  return function isStale() {
    return capturedGeneration !== workerState.currentGeneration;
  };
}

export function makeResult(ok, state, reason, newCount = 0) {
  return { ok, state, reason, newCount, timestamp: Date.now() };
}

export function isValidCheckResult(r) {
  return (
    r != null &&
    typeof r === 'object' &&
    typeof r.ok === 'boolean' &&
    (r.state === 'STATE_1' || r.state === 'STATE_2') &&
    typeof r.reason === 'string'
  );
}
