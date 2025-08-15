import fs from 'fs';
import path from 'path';

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function readTextFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) {
      throw new Error(`Empty file: ${filePath}`);
    }
    
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.trim());
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
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
