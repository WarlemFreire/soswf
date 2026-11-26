#!/usr/bin/env python3
"""Transcreve o audio de videos para texto (faster-whisper, na CPU, sem GPU e sem root).

Uso:
  python3 transcribe.py VIDEO.mp4 [VIDEO2.mp4 ...]            imprime o resultado de cada um (JSON)
  python3 transcribe.py --model small --threads 3 VIDEO.mp4
Requer: pip install --target ~/tools/pylibs faster-whisper   (o 'av' que vem junto decodifica o mp4)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / "tools" / "pylibs"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--model", default="small", help="tiny, base, small, medium (maior = melhor e mais lento)")
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--language", default=None, help="ex.: pt (padrao: detectar sozinho)")
    args = ap.parse_args()

    from faster_whisper import WhisperModel  # import tardio: so depois do sys.path

    t0 = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=args.threads,
                         download_root=str(Path.home() / "tools" / "whisper-models"))
    load_s = time.time() - t0
    for f in args.files:
        t1 = time.time()
        try:
            segments, info = model.transcribe(f, language=args.language, vad_filter=True, beam_size=1,
                                              condition_on_previous_text=False)
            text = " ".join(s.text.strip() for s in segments).strip()
            out = {"file": f, "ok": True, "language": info.language, "language_prob": round(info.language_probability, 2),
                   "audio_seconds": round(info.duration, 1), "took_seconds": round(time.time() - t1, 1),
                   "model_load_seconds": round(load_s, 1), "chars": len(text), "text": text}
        except Exception as e:  # video sem audio, arquivo corrompido etc.
            out = {"file": f, "ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
        print(json.dumps(out, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    os.nice(10)  # nao competir com n8n/WAHA
    main()
