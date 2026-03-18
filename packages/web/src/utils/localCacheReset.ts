export function restartCurrentSection() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // ignore sessionStorage failures
  }

  if ('clearResourceTimings' in window.performance) {
    window.performance.clearResourceTimings();
  }

  window.location.reload();
}
