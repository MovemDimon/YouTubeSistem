export function parseCookie(cookieData) {
  // اگر کوکی خالی بود
  if (!cookieData || typeof cookieData !== 'string') {
    console.warn('⚠️ Empty cookie data');
    return '';
  }
  
  try {
    // حالت 1: رشته کوکی مستقیم (name1=value1; name2=value2)
    if (cookieData.includes('=') && cookieData.includes(';')) {
      return cookieData;
    }
    
    // حالت 2: JSON استاندارد
    const parsed = JSON.parse(cookieData);
    
    // حالت 2-1: ساختار { cookies: [...] }
    if (parsed.cookies && Array.isArray(parsed.cookies)) {
      return parsed.cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
    }
    
    // حالت 2-2: ساختار مستقیم آرایه‌ای
    if (Array.isArray(parsed)) {
      return parsed
        .filter(c => c.name && c.value)
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
    }
    
    // حالت 3: ساختارهای غیرمعمول
    if (typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }
    
    return cookieData; // برگرداندن داده خام به عنوان fallback
  } catch (e) {
    // اگر JSON نبود، به عنوان رشته کوکی مستقیم استفاده می‌شود
    return cookieData;
  }
}

export const ACCOUNTS = [
  { name: "user1", cookie: parseCookie(process.env.COOKIE1) },
  { name: "user2", cookie: parseCookie(process.env.COOKIE2) },
  { name: "user3", cookie: parseCookie(process.env.COOKIE3) },
  { name: "user4", cookie: parseCookie(process.env.COOKIE4) },
  { name: "user5", cookie: parseCookie(process.env.COOKIE5) },
  { name: "user6", cookie: parseCookie(process.env.COOKIE6) },
  { name: "user7", cookie: parseCookie(process.env.COOKIE7) }
].filter(account => {
  const isValid = account.cookie && 
                 account.cookie.includes('=') && 
                 account.cookie.length > 20;
  if (!isValid) {
    console.warn(`⚠️ Invalid cookie for ${account.name}: ${account.cookie?.substring(0, 30)}...`);
  }
  return isValid;
});
