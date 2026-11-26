#!/usr/bin/env python3
"""Transforma as midias baixadas (ig_media.js) em TEXTO: OCR dos slides + transcricao dos videos.

Entrada : <dir>/media_manifest.jsonl e <dir>/media/<codigo>/{slide_NN.jpg,video_N.mp4}
Saida   : <dir>/content.jsonl  (uma linha por item; retomavel)
          {code, slides:[{file,text}], videos:[{file,audio_seconds,language,text}], ...}
Uso     : python3 media_to_text.py [--dir ~/work/ig] [--limit 0] [--codes A,B] [--model small] [--keep-videos]
Requer  : pip install --target ~/tools/pylibs faster-whisper rapidocr-onnxruntime opencv-python-headless
Roda com prioridade baixa (nice) para nao atrapalhar os outros servicos da VPS.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path.home() / "tools" / "pylibs"))


def read_jsonl(p: Path) -> list[dict]:
    if not p.is_file():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


class Engines:
    """Carrega OCR e reconhecimento de voz so quando precisa."""

    def __init__(self, model: str, threads: int) -> None:
        self.model_name, self.threads = model, threads
        self._ocr = None
        self._whisper = None

    def ocr(self, image: Path) -> str:
        if self._ocr is None:
            from rapidocr_onnxruntime import RapidOCR
            self._ocr = RapidOCR()
        result, _ = self._ocr(str(image))
        return "\n".join(r[1] for r in (result or []))

    def frames_text(self, video: Path, max_frames: int = 20) -> str:
        """Le o texto escrito NA IMAGEM do video: amostra quadros ao longo da duracao e junta as linhas unicas."""
        import av
        if self._ocr is None:
            from rapidocr_onnxruntime import RapidOCR
            self._ocr = RapidOCR()
        c = av.open(str(video))
        try:
            if not c.streams.video:
                return ""
            s = c.streams.video[0]
            dur = float(c.duration) / 1e6 if c.duration else 30.0
            step = max(2.0, dur / max_frames)
            next_t, frames = 0.0, []
            for fr in c.decode(s):
                if fr.pts is None:
                    continue
                t = float(fr.pts * s.time_base)
                if t >= next_t:
                    frames.append(fr.to_ndarray(format="bgr24"))
                    next_t = t + step
                if len(frames) >= max_frames:
                    break
        finally:
            c.close()
        seen, lines = set(), []
        for arr in frames:
            result, _ = self._ocr(arr)
            for r in (result or []):
                text = r[1].strip()
                key = "".join(ch for ch in text.lower() if ch.isalnum())
                if len(key) >= 4 and key not in seen:
                    seen.add(key)
                    lines.append(text)
        return "\n".join(lines)

    def has_audio(self, video: Path) -> bool:
        import av
        c = av.open(str(video))
        try:
            return len(c.streams.audio) > 0
        finally:
            c.close()

    def transcribe(self, video: Path) -> dict:
        if not self.has_audio(video):
            return {"audio_seconds": 0.0, "language": None, "text": "", "no_audio": True}
        if self._whisper is None:
            from faster_whisper import WhisperModel
            self._whisper = WhisperModel(self.model_name, device="cpu", compute_type="int8", cpu_threads=self.threads,
                                         download_root=str(Path.home() / "tools" / "whisper-models"))
        segments, info = self._whisper.transcribe(str(video), vad_filter=True, beam_size=1, condition_on_previous_text=False)
        text = " ".join(s.text.strip() for s in segments).strip()
        return {"audio_seconds": round(info.duration, 1), "language": info.language, "text": text}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path.home() / "work" / "ig"))
    ap.add_argument("--limit", type=int, default=0, help="quantos itens nesta execucao (0 = todos os pendentes)")
    ap.add_argument("--codes", default=None)
    ap.add_argument("--model", default="small")
    ap.add_argument("--threads", type=int, default=3)
    ap.add_argument("--keep-videos", action="store_true", help="nao apagar os videos depois de transcrever")
    args = ap.parse_args()
    os.nice(10)

    root = Path(args.dir)
    manifest = [r for r in read_jsonl(root / "media_manifest.jsonl") if r.get("embed_ok")]
    out_file = root / "content.jsonl"
    done = {r["code"] for r in read_jsonl(out_file)}
    todo = [r for r in manifest if r["code"] not in done]
    if args.codes:
        wanted = set(args.codes.split(","))
        todo = [r for r in manifest if r["code"] in wanted]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} itens a processar ({len(done)} ja prontos)", flush=True)

    eng = Engines(args.model, args.threads)
    for n, row in enumerate(todo, 1):
        t0 = time.time()
        folder = root / "media" / row["code"]
        rec: dict = {"code": row["code"], "slides": [], "videos": [], "errors": []}
        for im in row.get("images", []):
            try:
                rec["slides"].append({"file": im["file"], "text": eng.ocr(folder / im["file"])})
            except Exception as e:  # imagem corrompida etc.
                rec["errors"].append(f"ocr {im['file']}: {type(e).__name__}: {e}"[:200])
        for v in row.get("videos", []):
            path = folder / v["file"]
            entry = {"file": v["file"]}
            try:
                entry.update(eng.transcribe(path))
            except Exception as e:
                rec["errors"].append(f"voz {v['file']}: {type(e).__name__}: {e}"[:200])
            try:
                entry["onscreen_text"] = eng.frames_text(path)
            except Exception as e:
                rec["errors"].append(f"quadros {v['file']}: {type(e).__name__}: {e}"[:200])
            rec["videos"].append(entry)
            if not args.keep_videos and not rec["errors"]:
                path.unlink(missing_ok=True)
        rec["ocr_chars"] = sum(len(s["text"]) for s in rec["slides"])
        rec["transcript_chars"] = sum(len(v.get("text", "")) for v in rec["videos"])
        rec["onscreen_chars"] = sum(len(v.get("onscreen_text", "")) for v in rec["videos"])
        rec["processed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with open(out_file, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"[{n}/{len(todo)}] {row['code']}: {len(rec['slides'])} slides ({rec['ocr_chars']} car.), "
              f"{len(rec['videos'])} video(s) (fala {rec['transcript_chars']} car., na tela {rec['onscreen_chars']} car.), {time.time() - t0:.0f}s"
              + (f" ERROS: {rec['errors']}" if rec["errors"] else ""), flush=True)


if __name__ == "__main__":
    main()
