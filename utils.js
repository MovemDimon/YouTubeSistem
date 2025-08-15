import fs from 'fs';
import path from 'path';

// تابع جدید: ایجاد فایل اگر وجود ندارد
export function ensureFileExists(filePath, defaultValue = '') {
  const dir = path.dirname(filePath);
  
  // ایجاد پوشه اگر وجود ندارد
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // ایجاد فایل اگر وجود ندارد
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultValue);
    console.log(`📄 Created file: ${filePath}`);
    return true;
  }
  
  return false;
}

// تابع جدید: خواندن ایمن فایل‌های JSON
export function readJSONFile(filePath, defaultValue = []) {
  ensureFileExists(filePath, '[]');
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    return content ? JSON.parse(content) : defaultValue;
  } catch (error) {
    console.error(`Error reading JSON file ${filePath}:`, error.message);
    return defaultValue;
  }
}

// بقیه توابع (بدون تغییر)
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
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
  ensureFileExists(filePath, 'Sample content');
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.trim());
  } catch (error) {
    console.error(`Error reading text file ${filePath}:`, error.message);
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
