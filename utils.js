export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

export function pickUnique(key, items, usedSet) {
  const pool = items.filter(i => !usedSet.has(i));
  const chosen = pool.length
    ? pickRandom(pool)
    : pickRandom(items);
  usedSet.add(chosen);
  return chosen;
}
