const YT_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY;

let apiPromise = null;

export function loadYouTubeAPI() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube API requires a browser"));
  }
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };

    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = () => {
        apiPromise = null;
        reject(new Error("Failed to load YouTube IFrame API"));
      };
      document.head.appendChild(tag);
    }
  });

  return apiPromise;
}

export async function searchVideos(query, maxResults = 8) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (!YT_API_KEY) {
    throw new Error("Missing VITE_YOUTUBE_API_KEY in .env.local");
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(maxResults),
    q: trimmed,
    key: YT_API_KEY,
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "YouTube search failed");
  }

  return (data.items || [])
    .filter((item) => item?.id?.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet?.title || "Untitled",
      channelTitle: item.snippet?.channelTitle || "",
      thumbnail:
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url ||
        "",
    }));
}
