const fs = require('fs');
const path = require('path');

// تنظیمات
const TOTAL_LIKES_MIN = 3;
const TOTAL_LIKES_MAX = 6;
const ACCOUNTS_COUNT = JSON.parse(process.env.YOUTUBE_USERS).length;

// فایل ذخیره وضعیت
const likesFile = path.join(__dirname, '../likes.json');
let data = { comments: [] };
if (fs.existsSync(likesFile)) {
  data = JSON.parse(fs.readFileSync(likesFile, 'utf-8'));
}

// خواندن commentIdها
// فرض می‌کنیم data.comments آرایه از { commentId, lang, totalLikes, likedSoFar }
const comments = data.comments.map(item => {
  if (item.totalLikes == null) {
    item.totalLikes = TOTAL_LIKES_MIN + Math.floor(Math.random() * (TOTAL_LIKES_MAX - TOTAL_LIKES_MIN + 1));
    item.likedSoFar = 0;
  }
  // تعیین تعداد لایک در این اجرا
  const remaining = item.totalLikes - item.likedSoFar;
  const toLike = remaining > 0 ? 1 : 0;  // هر اجرا یک لایک برای هر کامنت
  // اگر می‌خواهید batch بزرگ‌تر، این مقدار را تغییر دهید
  return { ...item, toLike };
});

// ساخت عملیات لایک
const operations = [];
comments.forEach(item => {
  for (let i = 0; i < item.toLike; i++) {
    // انتخاب یک اکانت تصادفی
    const idx = Math.floor(Math.random() * ACCOUNTS_COUNT);
    operations.push({ commentId: item.commentId, accountIndex: idx });
    item.likedSoFar++;
  }
});

// ذخیره مجدد وضعیت
fs.writeFileSync(likesFile, JSON.stringify({ comments }, null, 2));

// خروجی JSON برای استفاده در GitHub Actions
console.log(JSON.stringify(operations));
