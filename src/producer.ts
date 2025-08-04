// src/producer.ts
import keywords_en from '../data/keywords/en.json';
import keywords_fa from '../data/keywords/fa.json';
import keywords_ru from '../data/keywords/ru.json';
import keywords_es from '../data/keywords/es.json';
import keywords_hi from '../data/keywords/hi.json';

type Lang = 'en' | 'fa' | 'ru' | 'es' | 'hi';
type Message = { platform: 'youtube'; videoId: string; lang: Lang; accountIndex: number };

const MAX_COMMENTS_PER_VIDEO = 7;

async function fetchYouTubeVideos(lang: string, keywords: string[], apiKey: string): Promise<string[]> {
  const videoIds = new Set<string>();
  for (const keyword of keywords) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(keyword)}&relevanceLanguage=${lang}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) continue;
    (await res.json()).items?.forEach((item: any) => item.id?.videoId && videoIds.add(item.id.videoId));
  }
  return Array.from(videoIds);
}

export default {
  async fetchAndProduce(queue: { send: (msg: any) => Promise<void> }, env: any) {
    const langs: Lang[] = ['en','fa','ru','es','hi'];
    const keywordsMap = { en: keywords_en, fa: keywords_fa, ru: keywords_ru, es: keywords_es, hi: keywords_hi };
    const apiKey = env.YOUTUBE_API_KEY;
    const accountsCount = JSON.parse(env.YOUTUBE_USERS).length;

    const totalTarget = 10000;
    let produced = 0;

    for (const lang of langs) {
      const videoIds = await fetchYouTubeVideos(lang, keywordsMap[lang], apiKey);
      const selected = videoIds.slice(0, 50);

      for (const videoId of selected) {
        const accountIndexes = Array.from({ length: accountsCount }, (_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, MAX_COMMENTS_PER_VIDEO);

        for (const idx of accountIndexes) {
          if (produced >= totalTarget) return;

          await queue.send({ platform: 'youtube', videoId, lang, accountIndex: idx });
          produced++;

          // تأخیر انسانی بین 1.5 تا 3 ثانیه
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
        }
      }
    }
  }
};
