import fetch from 'node-fetch';
import { delay } from './utils.js'; // تغییر از sleep به delay

const YOUTUBE_COMMENT_URL = 'https://www.youtube.com/comment_service_ajax';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export async function postComment(cookie, videoId, text) {
    const params = new URLSearchParams({
        action: 'post_comment',
        ctoken: 'comment_thread_' + videoId,
        type: 'POST',
        video_id: videoId,
        comment_text: text
    });

    const response = await fetch(YOUTUBE_COMMENT_URL, {
        method: 'POST',
        headers: {
            'Cookie': cookie,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.youtube.com',
            'Referer': `https://www.youtube.com/watch?v=${videoId}`
        },
        body: params.toString()
    });

    const data = await response.json();
    if (data.success) {
        return data.comment_id;
    }
    throw new Error('Failed to post comment: ' + (data.error || 'Unknown error'));
}

export async function likeComment(cookie, commentId) {
    const params = new URLSearchParams({
        action: 'like_comment',
        comment_id: commentId
    });

    const response = await fetch(YOUTUBE_COMMENT_URL, {
        method: 'POST',
        headers: {
            'Cookie': cookie,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com'
        },
        body: params.toString()
    });

    const data = await response.json();
    if (!data.success) {
        throw new Error('Failed to like comment: ' + (data.error || 'Unknown error'));
    }
    return true;
}

export async function postReply(cookie, commentId, text) {
    const params = new URLSearchParams({
        action: 'post_comment_reply',
        comment_id: commentId,
        comment_text: text
    });

    const response = await fetch(YOUTUBE_COMMENT_URL, {
        method: 'POST',
        headers: {
            'Cookie': cookie,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com'
        },
        body: params.toString()
    });

    const data = await response.json();
    if (data.success) {
        return data.comment_id;
    }
    throw new Error('Failed to post reply: ' + (data.error || 'Unknown error'));
}
