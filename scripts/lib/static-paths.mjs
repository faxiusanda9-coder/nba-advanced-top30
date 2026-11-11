export function normalizeBasePath(value = '') {
  if (value === '' || value === '/') return '';
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(value)) {
    throw new Error('Invalid static site base path');
  }
  return value.replace(/\/$/, '');
}

// Rebase only the site's own root-relative URLs. Preserve external URLs,
// relative ES module imports, regex route matchers and HTML closing tags.
export function rebaseStaticPaths(source, value) {
  const base = normalizeBasePath(value);
  if (!base) return source;
  return source.replace(/(["'`])\/(?=(?:assets|data|player|game|advanced-guide|daily-games|config\.json)(?:[/?#"'`])|["'`])/g,
    (_, quote) => `${quote}${base}/`);
}
