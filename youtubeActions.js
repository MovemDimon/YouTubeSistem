import fetch from 'node-fetch';
import crypto from 'crypto';
import { delay } from './utils.js';

const YT_BASE = 'https://www.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// ثابت‌ها (سازگار با بیشتر ویدئوها)
const DEFAULT_CLIENT_VERSION = '2.20250810';
const DEFAULT_CLIENT_NAME = 'WEB';
const DEFAULT_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

// تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');

  const time = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha1')
    .update(`${time} ${sapisid} ${YT_BASE}`)
    .digest('hex');
}

// ساختار JSON مشابه مرورگر برای ایجاد کامنت
function buildCommentBody(videoId, text) {
  return {
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: DEFAULT_CLIENT_NAME,
        clientVersion: DEFAULT_CLIENT_VERSION
      }
    },
    commentText: text,
    // createCommentParams واقعی باید از front-end استخراج شود
    createCommentParams: 'Cg0KC2V4YW1wbGVW' // نمونه placeholder معتبر
  };
}

// ارسال کامنت
export async function postComment(cookie, videoId, text) {
  if (!cookie || !videoId || !text) throw new Error('Missing required parameters');

  const authHash = generateAuthHash(cookie);
  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
    'Cookie': cookie,
    'Origin': YT_BASE,
    'Referer': `${YT_BASE}/watch?v=${videoId}`,
    'X-Origin': YT_BASE,
    'X-Youtube-Client-Name': DEFAULT_CLIENT_NAME,
    'X-Youtube-Client-Version': DEFAULT_CLIENT_VERSION,
    'X-Goog-AuthUser': '0',
    'X-Goog-PageId': Math.floor(Math.random() * 1000000000).toString()
  };

  const body = buildCommentBody(videoId, text);
  const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment?key=${DEFAULT_API_KEY}&prettyPrint=false`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'YouTube API error');
    }

    return data.commentId || data.comment_id;
  } catch (err) {
    console.error('Error posting comment:', { videoId, error: err.message });
    throw err;
  }
}

// لایک کامنت
export async function likeComment(cookie, commentId) {
  if (!cookie || !commentId) throw new Error('Missing required parameters');

  const authHash = generateAuthHash(cookie);
  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
    'Cookie': cookie
  };

  const body = {
    commentId,
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: DEFAULT_CLIENT_NAME,
        clientVersion: DEFAULT_CLIENT_VERSION
      }
    }
  };

  const apiUrl = `${YT_BASE}/youtubei/v1/comment/like_comment?key=${DEFAULT_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return data.success;
}

// ارسال پاسخ به کامنت
export async function postReply(cookie, commentId, text) {
  if (!cookie || !commentId || !text) throw new Error('Missing required parameters');

  const authHash = generateAuthHash(cookie);
  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
    'Cookie': cookie
  };

  const body = {
    commentId,
    commentText: text,
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: DEFAULT_CLIENT_NAME,
        clientVersion: DEFAULT_CLIENT_VERSION
      }
    }
  };

  const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment_reply?key=${DEFAULT_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return data.commentId || data.comment_id;
}
