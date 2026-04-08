export function rankTextMatch(target: string, query: string) {
  const normalizedTarget = target.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedTarget === normalizedQuery) {
    return 100;
  }

  if (normalizedTarget.startsWith(normalizedQuery)) {
    return 80;
  }

  if (normalizedTarget.includes(normalizedQuery)) {
    return 50;
  }

  return 0;
}
