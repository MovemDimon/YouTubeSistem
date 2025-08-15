import fetch from 'node-fetch';
import crypto from 'crypto';
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

// استخراج پارامترهای API ثابت (نیاز به jsdom نیست)
function getStaticParams() {
  return {
    clientVersion: '2.20250810',
    apiKey: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    clientName: 'WEB'
  };
}

// ساخت بدنه createCommentParams
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

// هدرهای استاندارد
function buildHeaders(cookie, authHash, clientName, clientVersion, videoId) {
  return {
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
}

// ارسال کامنت
export async function postComment(cookie, videoId, text) {
  try {
    const { clientVersion, apiKey, clientName } = getStaticParams();
    const authHash = generateAuthHash(cookie);
    const createCommentParams = buildCreateCommentParams(videoId);

    const body = {
      context: { client: { hl: 'en', gl: 'US', clientName, clientVersion } },
      commentText: text,
      createCommentParams
    };

    const response = await fetch(`${YT_BASE}/youtubei/v1/comment/create_comment?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: buildHeaders(cookie, authHash, clientName, clientVersion, videoId),
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'YouTube API error');
    return data.commentId || data.comment_id;
  } catch (err) {
    console.error('Error posting comment:', { videoId, error: err.message });
    throw err;
  }
}

// ارسال ریپلای
export async function postReply(cookie, commentId, text) {
  try {
    const { clientVersion, apiKey, clientName } = getStaticParams();
    const authHash = generateAuthHash(cookie);

    const body = {
      context: { client: { hl: 'en', gl: 'US', clientName, clientVersion } },
      commentText: text,
      parentId: commentId
    };

    const response = await fetch(`${YT_BASE}/youtubei/v1/comment/create_comment?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: buildHeaders(cookie, authHash, clientName, clientVersion, commentId),
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'YouTube API error');
    return data.commentId || data.comment_id;
  } catch (err) {
    console.error('Error posting reply:', { commentId, error: err.message });
    throw err;
  }
}

// لایک کامنت
export async function likeComment(cookie, commentId) {
  try {
    const { clientVersion, apiKey, clientName } = getStaticParams();
    const authHash = generateAuthHash(cookie);

    const body = {
      context: { client: { hl: 'en', gl: 'US', clientName, clientVersion } },
      targetId: commentId,
      like: 'LIKE'
    };

    const response = await fetch(`${YT_BASE}/youtubei/v1/like/like_comment?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: buildHeaders(cookie, authHash, clientName, clientVersion, commentId),
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'YouTube API error');
    return true;
  } catch (err) {
    console.error('Error liking comment:', { commentId, error: err.message });
    throw err;
  }
}
