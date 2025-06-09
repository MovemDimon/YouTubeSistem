import fetch from 'node-fetch';

type YouTubeAccount = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const COMMENT_URL = 'https://www.googleapis.com/youtube/v3/commentThreads';

export async function refreshAccessToken(account: YouTubeAccount): Promise<string> {
  const params = new URLSearchParams({
    client_id: account.client_id,
    client_secret: account.client_secret,
    refresh_token: account.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: params,
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh access token: ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

export async function postComment(
  access_token: string,
  videoId: string,
  text: string
): Promise<void> {
  const body = {
    snippet: {
      videoId: videoId,
      topLevelComment: {
        snippet: {
          textOriginal: text,
        },
      },
    },
  };

  const res = await fetch(COMMENT_URL + '?part=snippet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to post comment: ${await res.text()}`);
  }
}
