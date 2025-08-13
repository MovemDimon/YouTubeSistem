import fs from 'fs';
import { ACCOUNTS } from './youtube_cookies.js';
import { sleep, pickRandom, shuffle, pickUnique } from './utils.js';

const LANGS = ['en', 'fa', 'ru', 'es', 'hi'];

async function postComment(cookie, videoId, text) {
  // TODO: استفاده از puppeteer یا fetch با simulate form
  console.log(`💬 [${videoId}] COMMENT: ${text.slice(0, 30)}...`);
}

async function likeComment(cookie, commentId) {
  // TODO: ارسال درخواست لایک به commentId با کوکی
  console.log(`👍 LIKE sent to ${commentId}`);
}

async function replyComment(cookie, parentId, text) {
  // TODO: ارسال ریپلای به commentId
  console.log(`↪️ Reply: ${text.slice(0, 30)}...`);
}

async function loadStatus() {
  return JSON.parse(fs.readFileSync('status.json', 'utf8'));
}

async function updateStatus(count) {
  const status = await loadStatus();
  status.posted_comments += count;
  fs.writeFileSync('status.json', JSON.stringify(status, null, 2));
}

async function main() {
  const status = await loadStatus();
  if (status.posted_comments >= status.max_comments) {
    console.log("🎯 Goal reached. System will stop.");
    return;
  }

  const accounts = shuffle(ACCOUNTS);
  const lang = pickRandom(LANGS);
  const videos = JSON.parse(fs.readFileSync(`data/videos/${lang}.json`, 'utf8'));
  const comments = fs.readFileSync(`data/comments/${lang}.txt`, 'utf8').split('\n').filter(Boolean);
  const replies = fs.readFileSync(`data/replies/${lang}.txt`, 'utf8').split('\n').filter(Boolean);

  const usedMap = new Map();
  let sent = 0;

  for (const account of accounts) {
    const target = pickRandom(videos);
    const usedSet = usedMap.get(target.videoId) || new Set();
    const text = pickUnique(target.videoId, comments, usedSet);
    usedMap.set(target.videoId, usedSet);

    await postComment(account.cookie, target.videoId, text);
    sent++;

    const commentId = `${target.videoId}-${Date.now()}`; // fake

    const likeCount = 3 + Math.floor(Math.random() * 5);
    const likers = shuffle(accounts.filter(a => a !== account)).slice(0, likeCount);

    for (const liker of likers) {
      await sleep(2000 + Math.random() * 3000);
      await likeComment(liker.cookie, commentId);
    }

    const replyCount = Math.floor(Math.random() * 4);
    const repliers = shuffle(accounts.filter(a => a !== account)).slice(0, replyCount);

    for (const replier of repliers) {
      const reply = pickUnique(commentId, replies, new Set());
      await sleep(2000 + Math.random() * 3000);
      await replyComment(replier.cookie, commentId, reply);
    }

    await sleep(5000 + Math.random() * 4000);
  }

  await updateStatus(sent);
  console.log(`📈 Sent ${sent} new comments.`);
}

main();
