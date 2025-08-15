import fetch from 'node-fetch';
import crypto from 'crypto';
import { JSDOM } from 'jsdom';
import { delay } from './utils.js';

const YT_BASE = 'https://www.youtube.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// تابع تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');
  
  const time = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha1')
    .update(`${time} ${sapisid} ${YT_BASE}`)
    .digest('hex');
}

// استخراج پارامترهای داینامیک صفحه ویدیو
async function extractPageParams(videoId, cookie) {
  try {
    const response = await fetch(`${YT_BASE}/watch?v=${videoId}`, {
      headers: {
        'Cookie': cookie,
        'User-Agent': USER_AGENT
      }
    });
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const scripts = dom.window.document.querySelectorAll('script');

    let clientVersion = '2.20250810';
    let apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    let clientName = '1'; // WEB

    for (const script of scripts) {
      const txt = script.textContent;
      if (!txt) continue;

      if (txt.includes('INNERTUBE_CLIENT_VERSION')) {
        const vMatch = txt.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
        if (vMatch) clientVersion = vMatch[1];

        const kMatch = txt.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
        if (kMatch) apiKey = kMatch[1];

        const nMatch = txt.match(/"INNERTUBE_CLIENT_NAME":(\d+)/);
        if (nMatch) clientName = nMatch[1];
      }
    }

    return { clientVersion, apiKey, clientName };
  } catch (err) {
    console.error('Error extracting page params:', err.message);
    return { clientVersion: '2.20250810', apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', clientName: '1' };
  }
}

// ارسال کامنت
export async function postComment(cookie, videoId, text) {
  try {
    if (!cookie || !videoId || !text) throw new Error('Missing required parameters');

    const { clientVersion, apiKey, clientName } = await extractPageParams(videoId, cookie);
    const authHash = generateAuthHash(cookie);

    // ساختار درست createCommentParams از Base64 استاندارد
    const createCommentParams = Buffer.from(JSON.stringify({
      videoId: videoId,
      params: 'Cg0KCxIQAQ%3D%3D' // قالب استاندارد برای comment
    })).toString('base64');

    const body = {
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: 'WEB',
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

    const response = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();

    if (data.error) {
      console.error('YouTube API Error:', { code: data.error.code, message: data.error.message, status: response.status, endpoint: apiUrl });
      throw new Error(data.error.message || 'YouTube API error');
    }

    return data.commentId || data.comment_id;

  } catch (err) {
    console.error('Error posting comment:', { videoId, error: err.message, stack: err.stack });
    throw err;
  }
}

// لایک کامنت
export async function likeComment(cookie, commentId) {
  if (!cookie || !commentId) throw new Error('Missing parameters');

  const { clientVersion, apiKey, clientName } = await extractPageParams(commentId, cookie);
  const authHash = generateAuthHash(cookie);

  const body = {
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: clientVersion
      }
    },
    targetCommentId: commentId
  };

  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
    'Cookie': cookie,
    'Origin': YT_BASE,
    'X-Origin': YT_BASE,
    'X-Youtube-Client-Name': clientName,
    'X-Youtube-Client-Version': clientVersion,
    'X-Goog-AuthUser': '0'
  };

  const apiUrl = `${YT_BASE}/youtubei/v1/comment/like_comment?key=${apiKey}&prettyPrint=false`;
  const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();

  return data.success;
}

// ارسال پاسخ
export async function postReply(cookie, commentId, text) {
  if (!cookie || !commentId || !text) throw new Error('Missing parameters');

  const { clientVersion, apiKey, clientName } = await extractPageParams(commentId, cookie);
  const authHash = generateAuthHash(cookie);

  const body = {
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: clientVersion
      }
    },
    commentId: commentId,
    commentText: text
  };

  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    'Authorization': `SAPISIDHASH ${Math.floor(Date.now() / 1000)}_${authHash}`,
    'Cookie': cookie,
    'Origin': YT_BASE,
    'X-Origin': YT_BASE,
    'X-Youtube-Client-Name': clientName,
    'X-Youtube-Client-Version': clientVersion,
    'X-Goog-AuthUser': '0'
  };

  const apiUrl = `${YT_BASE}/youtubei/v1/comment/create_comment_reply?key=${apiKey}&prettyPrint=false`;
  const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();

  if (data.error) throw new Error(data.error.message || 'YouTube API error');

  return data.commentId || data.comment_id;
}
