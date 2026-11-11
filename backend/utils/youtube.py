# youtube.py
"""YouTube helpers: URL detection and transcript fetching (youtube-transcript-api 1.x)."""

import logging
import os
import re

from youtube_transcript_api import (
    YouTubeTranscriptApi,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
    RequestBlocked,
)

logger = logging.getLogger(__name__)

PREFERRED_LANGS = ['en', 'en-US', 'en-GB']


def is_youtube_url(url: str) -> bool:
    """
    Checks if the given URL is a valid YouTube URL.
    """
    if not isinstance(url, str):
        return False
    # Regex to check for various youtube URL formats
    youtube_regex = (
        r'(https?://)?(www\.)?'
        r'(youtube|youtu|youtube-nocookie)\.(com|be)/'
        r'(watch\?v=|embed/|v/|.+\?v=)?([^&=%\?]{11})')
    return re.match(youtube_regex, url) is not None


def extract_video_id(url: str) -> str | None:
    regex = (
        r"(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:[^\/\n\s]+\/\S+\/|"
        r"(?:v|e(?:mbed)?|shorts|live)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})"
    )
    match = re.search(regex, url or "")
    return match.group(1) if match else None


def _transcript_api() -> YouTubeTranscriptApi:
    """
    YouTube blocks transcript requests from most cloud IPs (AWS, GCP, ...).
    Set YOUTUBE_PROXY_URL (e.g. a residential proxy, http://user:pass@host:port)
    to route the requests through it.
    """
    proxy_url = os.getenv("YOUTUBE_PROXY_URL")
    if proxy_url:
        from youtube_transcript_api.proxies import GenericProxyConfig
        return YouTubeTranscriptApi(proxy_config=GenericProxyConfig(http_url=proxy_url, https_url=proxy_url))
    return YouTubeTranscriptApi()


def get_youtube_transcript(url: str) -> tuple[str | None, str | None]:
    """
    Fetches the transcript for a given YouTube URL.
    Returns (transcript_text, None) on success or (None, readable_error) on failure.
    """
    video_id = extract_video_id(url)
    if not video_id:
        return None, "Invalid YouTube URL: Could not extract video ID."

    try:
        transcript_list = _transcript_api().list(video_id)
        selected = None

        # 1) Human-created English captions, 2) auto-generated English captions
        for finder in (transcript_list.find_manually_created_transcript,
                       transcript_list.find_generated_transcript):
            try:
                selected = finder(PREFERRED_LANGS)
                break
            except NoTranscriptFound:
                continue

        # 3) Any transcript translated to English, 4) any transcript at all
        if selected is None:
            available = list(transcript_list)
            for t in available:
                if t.is_translatable:
                    try:
                        selected = t.translate('en')
                        break
                    except Exception:
                        continue
            if selected is None and available:
                selected = available[0]
        if selected is None:
            return None, "This video has no captions or transcript."

        snippets = selected.fetch()
        transcript_text = " ".join(s.text for s in snippets if s.text).strip()
        if not transcript_text:
            return None, "The video's transcript is empty."
        return transcript_text, None

    except TranscriptsDisabled:
        return None, "Captions are turned off for this video."
    except NoTranscriptFound:
        return None, "This video has no captions or transcript."
    except VideoUnavailable:
        return None, "This video is unavailable (private, removed or region-locked)."
    except RequestBlocked:  # also covers IpBlocked
        logger.warning("YouTube blocked the transcript request for %s", video_id)
        return None, "YouTube blocked our request for the transcript (this happens from cloud servers)."
    except Exception as e:
        message = str(e)
        logger.warning("Transcript fetch failed for %s: %s", video_id, message[:300])
        if '429' in message or 'Too Many Requests' in message:
            return None, "YouTube rate-limited the transcript request. Please try again later."
        return None, "Could not fetch the video's transcript."
