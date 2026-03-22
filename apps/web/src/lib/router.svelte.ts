let current = $state(window.location.hash.slice(1) || "/");
let onNavigateCallback: (() => void) | null = null;

window.addEventListener("hashchange", () => {
  current = window.location.hash.slice(1) || "/";
  onNavigateCallback?.();
});

export function navigate(path: string) {
  window.location.hash = path;
}

export function getRoute(): string {
  return current;
}

export function onNavigate(callback: () => void) {
  onNavigateCallback = callback;
}
