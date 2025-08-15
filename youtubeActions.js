import fetch from 'node-fetch';
import { delay } from './utils.js';
import crypto from 'crypto';

// تنظیمات پایه
const YOUTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/comment';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';

// تابع کمکی برای تولید SAPISIDHASH
function generateAuthHash(cookie) {
  const sapisid = cookie.match(/SAPISID=([^;]+)/)?.[1];
  if (!sapisid) throw new Error('SAPISID not found in cookie');
  
  const time = Math.floor(Date.now() / 1000);
  return `${time}_${crypto.createHash('sha1')
    .update(`${time} ${sapisid} https://www.youtube.com`)
    .digest('hex')}`;
}

// هدرهای مشترک
const COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'X-Origin': 'https://www.youtube.com',
  'X-Youtube-Client-Name': '1',
  'X-Youtube-Client-Version': '2.20240610',
  'Content-Type': 'application/json'
};

export async function postComment(cookie, videoId, text) {
  if (!videoId) throw new Error('Missing videoId parameter');
  if (!text) throw new Error('Missing comment text');
  if (!cookie.includes('SAPISID')) throw new Error('Invalid cookie format');

  try {
    const response = await fetch(`${YOUTUBE_API_URL}/create_comment`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Authorization': `SAPISIDHASH ${generateAuthHash(cookie)}`,
        'Cookie': cookie,
        'Referer': `https://www.youtube.com/watch?v=${videoId}`
      },
      body: JSON.stringify({
        commentText: text,
        videoId: videoId,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240610'
          }
        }
      })
    });

    if (response.status === 429) {
      throw new Error('Rate limit exceeded');
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'YouTube API error');
    }
    
    return data.commentId || data.comment_id;
  } catch (error) {
    console.error('Error posting comment:', {
      videoId,
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
}

export async function likeComment(cookie, commentId) {
  if (!commentId) throw new Error('Missing commentId parameter');
  if (!cookie.includes('SAPISID')) throw new Error('Invalid cookie format');

  try {
    const response = await fetch(`${YOUTUBE_API_URL}/like_comment`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Authorization': `SAPISIDHASH ${generateAuthHash(cookie)}`,
        'Cookie': cookie,
        'Referer': 'https://www.youtube.com'
      },
      body: JSON.stringify({
        commentId: commentId,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240610'
          }
        }
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Failed to like comment');
    }
    return true;
  } catch (error) {
    console.error('Error liking comment:', {
      commentId,
      error: error.message
    });
    throw error;
  }
}

export async function postReply(cookie, commentId, text) {
  if (!commentId) throw new Error('Missing commentId parameter');
  if (!text) throw new Error('Missing reply text');
  if (!cookie.includes('SAPISID')) throw new Error('Invalid cookie format');

  try {
    const response = await fetch(`${YOUTUBE_API_URL}/create_comment_reply`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Authorization': `SAPISIDHASH ${generateAuthHash(cookie)}`,
        'Cookie': cookie,
        'Referer': 'https://www.youtube.com'
      },
      body: JSON.stringify({
        commentId: commentId,
        commentText: text,
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240610'
          }
        }
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Failed to post reply');
    }
    return data.commentId || data.comment_id;
  } catch (error) {
    console.error('Error posting reply:', {
      commentId,
      error: error.message
    });
    throw error;
  }
}
