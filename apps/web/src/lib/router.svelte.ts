let current = $state(window.location.hash.slice(1) || "/");

window.addEventListener("hashchange", () => {
  current = window.location.hash.slice(1) || "/";
});

export function navigate(path: string) {
  window.location.hash = path;
}

export function getRoute(): string {
  return current;
}
