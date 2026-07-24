#!/usr/bin/env python3
"""Call OpenAI Whisper API on each scene MP3 and save raw timestamped output."""

import json
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI()  # reads OPENAI_API_KEY from environment

REPO = Path(__file__).parent.parent
AUDIO_DIR = REPO / "audio"
RAW_DIR = REPO / "data" / "raw"
SCENES = ["12", "15", "16", "17", "18"]

# Prime Whisper with character names and context to improve Hebrew accuracy
PROMPT = (
    "מחזה תיאטרון בעברית. שחקנים: הרב, קלאופטרה, שימי, לילי, "
    "אינליאל, שיראל, דיצה, ברונו, כרמלה, מישה, שרה, בנבנישתי. "
    "דיאלוג רציף, עברית מדוברת."
)


def transcribe(scene: str) -> dict:
    audio_path = AUDIO_DIR / f"תמונה {scene}.mp3"
    print(f"[{scene}] Transcribing {audio_path.name} …")
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            language="he",
            response_format="verbose_json",
            timestamp_granularities=["segment", "word"],
            prompt=PROMPT,
        )
    return response.model_dump()


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for scene in SCENES:
        out = RAW_DIR / f"scene-{scene}-whisper.json"
        if out.exists():
            print(f"[{scene}] Already done, skipping.")
            continue
        data = transcribe(scene)
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[{scene}] Saved → {out}")


if __name__ == "__main__":
    main()
