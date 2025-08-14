import fs from 'fs';
import path from 'path';

// تابع جدید اضافه شده
export function getLangFromFilename(filename) {
  return filename.split('.')[0];
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

export function pickUnique(key, items, usedSet) {
  const pool = items.filter(i => !usedSet.has(i));
  const chosen = pool.length ? pickRandom(pool) : pickRandom(items);
  usedSet.add(chosen);
  return chosen;
}

export async function retryOperation(fn, operationName, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`⚠️ Retry ${attempt}/${retries} for ${operationName}:`, e.message);
      if (attempt < retries) await delay(delayMs * attempt);
      else throw e;
    }
  }
}

export function validateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.trim()) {
    throw new Error(`Empty file: ${filePath}`);
  }
  return content;
}
