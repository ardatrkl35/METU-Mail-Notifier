/**
 * Portable timeout + optional external abort composition (replaces AbortSignal.any / AbortSignal.timeout).
 * @param {number} ms
 * @param {AbortSignal} [externalSignal]
 * @returns {{ signal: AbortSignal, cleanup: () => void }}
 */
export function createTimeoutController(ms, externalSignal) {
  const controller = new AbortController();
  let timerId = null;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  const onExternalAbort = () => {
    cleanup();
    try {
      controller.abort(externalSignal.reason);
    } catch (_) {
      controller.abort();
    }
  };

  if (externalSignal?.aborted) {
    onExternalAbort();
    return { signal: controller.signal, cleanup };
  }

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  timerId = setTimeout(() => {
    timerId = null;
    if (cleaned) return;
    cleaned = true;
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    const reason =
      typeof DOMException !== 'undefined'
        ? new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        : Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    controller.abort(reason);
  }, ms);

  return { signal: controller.signal, cleanup };
}
