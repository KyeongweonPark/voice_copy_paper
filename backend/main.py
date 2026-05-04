from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from threading import Lock
from typing import Literal

import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse


ROOT = Path(__file__).resolve().parent
STORAGE_DIR = ROOT / "storage"
MODEL_DIR = ROOT / "models" / "Qwen3-TTS-12Hz-0.6B-Base"
MODEL_ID = os.getenv("QWEN_TTS_MODEL", str(MODEL_DIR if MODEL_DIR.exists() else "Qwen/Qwen3-TTS-12Hz-0.6B-Base"))

Language = Literal[
    "Auto",
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]

app = FastAPI(title="Voice Studio Local TTS", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("VOICE_STUDIO_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_model = None
_model_lock = Lock()


def _ensure_storage() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def _session_dir(session_id: str) -> Path:
    return STORAGE_DIR / session_id


def _run_ffmpeg(input_path: Path, output_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="ffmpeg is required to normalize uploaded audio.")

    command = [
        ffmpeg,
        "-y",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        str(output_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Audio conversion failed: {completed.stderr[-600:]}")


def _device_config() -> tuple[str, torch.dtype]:
    if torch.cuda.is_available():
        return "cuda:0", torch.bfloat16
    if torch.backends.mps.is_available():
        return "mps", torch.float16
    return "cpu", torch.float32


def _load_model():
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        from qwen_tts import Qwen3TTSModel

        device, dtype = _device_config()
        try:
            _model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
        except Exception:
            if device == "cpu":
                raise
            _model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map="cpu", dtype=torch.float32)
        return _model


@app.get("/health")
def health():
    model_exists = MODEL_DIR.exists()
    return {
        "ok": True,
        "model": MODEL_ID,
        "localModelReady": model_exists,
        "device": _device_config()[0],
    }


@app.post("/analyze")
async def analyze_voice(
    audio: UploadFile = File(...),
    ref_text: str = Form(...),
    consent: bool = Form(...),
):
    if not consent:
        raise HTTPException(status_code=400, detail="Consent is required before analyzing a voice sample.")
    if len(ref_text.strip()) < 5:
        raise HTTPException(status_code=400, detail="Reference text is too short.")

    _ensure_storage()
    session_id = uuid.uuid4().hex
    work_dir = _session_dir(session_id)
    work_dir.mkdir(parents=True, exist_ok=False)

    suffix = Path(audio.filename or "sample.webm").suffix or ".webm"
    raw_path = work_dir / f"reference_raw{suffix}"
    wav_path = work_dir / "reference.wav"

    with raw_path.open("wb") as target:
        while chunk := await audio.read(1024 * 1024):
            target.write(chunk)

    _run_ffmpeg(raw_path, wav_path)
    info = sf.info(wav_path)

    metadata = {
        "sessionId": session_id,
        "refText": ref_text.strip(),
        "audioPath": str(wav_path),
        "durationSeconds": round(float(info.duration), 2),
        "sampleRate": info.samplerate,
    }
    (work_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "sessionId": session_id,
        "durationSeconds": metadata["durationSeconds"],
        "sampleRate": metadata["sampleRate"],
        "message": "Reference voice normalized and ready for local synthesis.",
    }


@app.post("/synthesize")
async def synthesize_voice(
    session_id: str = Form(...),
    text: str = Form(...),
    language: Language = Form("Korean"),
    style: str = Form("natural"),
):
    clean_text = text.strip()
    if len(clean_text) < 1:
        raise HTTPException(status_code=400, detail="Text is required.")

    work_dir = _session_dir(session_id)
    metadata_path = work_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(status_code=404, detail="Voice session not found. Analyze a sample first.")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    # The Base voice-clone model primarily follows the reference speaker.
    # Style is accepted for API stability and future CustomVoice/VoiceDesign adapters.
    _ = style

    model = _load_model()
    wavs, sample_rate = model.generate_voice_clone(
        text=clean_text,
        language=language,
        ref_audio=metadata["audioPath"],
        ref_text=metadata["refText"],
    )

    output_path = work_dir / f"generated-{uuid.uuid4().hex}.wav"
    sf.write(output_path, wavs[0], sample_rate)

    return FileResponse(
        output_path,
        media_type="audio/wav",
        filename="generated-voice.wav",
        headers={"X-Voice-Session": session_id},
    )
