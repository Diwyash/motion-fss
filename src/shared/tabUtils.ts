export function getTabHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function getTabFallbackTitle(title: string, url: string): string {
  if (title.trim()) {
    return title;
  }

  const host = getTabHost(url);
  return host || 'New Tab';
}
