export function parseCookie(cookieData) {
  if (!cookieData || typeof cookieData !== 'string') {
    console.warn('⚠️ Empty cookie data');
    return '';
  }
  
  try {
    if (cookieData.includes('=') && cookieData.includes(';')) {
      return cookieData;
    }
    
    const parsed = JSON.parse(cookieData);
    
    if (parsed.cookies && Array.isArray(parsed.cookies)) {
      return parsed.cookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
    }
    
    if (Array.isArray(parsed)) {
      return parsed
        .filter(c => c.name && c.value)
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
    }
    
    if (typeof parsed === 'object') {
      return Object.entries(parsed)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }
    
    return cookieData;
  } catch (e) {
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
    console.warn(`⚠️ Invalid cookie for ${account.name}`);
  }
  return isValid;
});
