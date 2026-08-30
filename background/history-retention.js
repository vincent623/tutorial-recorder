export function planHistoryRetention(currentHistory = [], nextEntry = {}, limit = 100) {
  const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 100);
  const seen = new Set();
  const candidates = [nextEntry, ...(Array.isArray(currentHistory) ? currentHistory : [])].filter((item) => {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  const history = candidates.slice(0, normalizedLimit);
  const keptIds = new Set(history.map((item) => item.id));
  const evictedIds = [...new Set(candidates.slice(normalizedLimit).map((item) => item.id))].filter(
    (id) => !keptIds.has(id)
  );

  return { history, evictedIds };
}
