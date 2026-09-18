export function isSearchShortcut(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing?: boolean }) {
  return !event.isComposing && !event.altKey && (event.ctrlKey || event.metaKey) && (event.code === "KeyK" || event.key.toLowerCase() === "k")
}

export function searchPageHref(path: string, query: string) {
  return `${path}?${new URLSearchParams({ q: query })}`
}
