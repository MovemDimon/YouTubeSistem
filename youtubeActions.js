import fetch from 'node-fetch';
import crypto from 'crypto';
import { delay } from './utils.js';

const YT_BASE = 'https://www.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');
  
  const time = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha1')
    .update(`${time} ${sapisid} ${YT_BASE}`)
    .digest('hex');
}

// استخراج پارامترها از HTML بدون jsdom
async function extractPageParams(videoId, cookie) {
  try {
    const res = await fetch(`${YT_BASE}/watch?v=${videoId}`, {
      headers: {
        'Cookie': cookie,
        'User-Agent': USER_AGENT
      }
    });
    const html = await res.text();

    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || '2.20250810';
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const clientNameNum = html.match(/"INNERTUBE_CLIENT_NAME":(\d+)/)?.[1] || '1';

    return { clientVersion, apiKey, clientName: clientNameNum };
  } catch (err) {
    console.error('Error extracting page params:', err.message);
    return {
      clientVersion: '2.20250810',
      apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      clientName: '1'
    };
  }
}

// ساخت createCommentParams شبیه مرورگر
function buildCreateCommentParams(videoId) {
  const params = {
    videoId: videoId,
    serializedComment: null,
    params: {
      index: 0,
      page: "watch",
      target: "watch-discussion"
    }
  };
  return Buffer.from(JSON.stringify(params)).toString('base64');
}

// ارسال کامنت (Plan B بدون jsdom)
export async function postComment(cookie, videoId, text) {
  try {
    if (!cookie || !videoId || !text) {
      throw new Error('Missing required parameters');
    }

    const { clientVersion, apiKey, clientName } = await extractPageParams(videoId, cookie);
    const authHash = generateAuthHash(cookie);
    const createCommentParams = buildCreateCommentParams(videoId);

    const body = {
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: clientName,
          clientVersion: clientVersion
        }
      },
      commentText: text,
      createCommentParams: createCommentParams
    };

    const headers = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
      'Cookie': cookie,
      'Origin': YT_BASE,
      'Referer': `${YT_BASE}/watch?v=${videoId}`,
      'X-Origin': YT_BASE,
      'X-Youtube-Client-Name': clientName,
      'X-Youtube-Client-Version': clientVersion,
      'X-Goog-AuthUser': '0',
      'X-Goog-PageId': Math.floor(Math.random() * 1000000000).toString()
    };

    const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment?key=${apiKey}&prettyPrint=false`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) {
      console.error('YouTube API Error:', {
        code: data.error.code,
        message: data.error.message,
        status: response.status,
        endpoint: apiUrl
      });
      throw new Error(data.error.message || 'YouTube API error');
    }

    return data.commentId || data.comment_id;
  } catch (error) {
    console.error('Error posting comment:', {
      videoId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// لایک کردن کامنت
export async function likeComment(cookie, commentId) {
  try {
    if (!commentId || !cookie) throw new Error('Missing required parameters');
    const { clientVersion, apiKey, clientName } = await extractPageParams('dQw4w9WgXcQ', cookie); // ویدیو تست
    const authHash = generateAuthHash(cookie);

    const body = {
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: clientName,
          clientVersion: clientVersion
        }
      },
      commentId: commentId
    };

    const apiUrl = `${YT_BASE}/youtubei/v1/comment/like_comment?key=${apiKey}&prettyPrint=false`;
    const headers = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
      'Cookie': cookie
    };

    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json();
    return data.success;
  } catch (err) {
    console.error('Error liking comment:', err.message);
    throw err;
  }
}

// ارسال پاسخ به کامنت
export async function postReply(cookie, commentId, text) {
  try {
    if (!commentId || !text || !cookie) throw new Error('Missing required parameters');
    const { clientVersion, apiKey, clientName } = await extractPageParams('dQw4w9WgXcQ', cookie);
    const authHash = generateAuthHash(cookie);

    const body = {
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: clientName,
          clientVersion: clientVersion
        }
      },
      commentId: commentId,
      commentText: text
    };

    const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment_reply?key=${apiKey}&prettyPrint=false`;
    const headers = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
      'Cookie': cookie
    };

    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json();
    return data.commentId || data.comment_id;
  } catch (err) {
    console.error('Error posting reply:', err.message);
    throw err;
  }
}
