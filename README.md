# Voice Studio

React, Next.js, and a local FastAPI backend for consent-based voice sample recording and local TTS synthesis.

## Model Download

The backend uses the public Hugging Face model [`Qwen/Qwen3-TTS-12Hz-0.6B-Base`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base).

It was selected because it supports Korean voice cloning, runs locally, and is Apache-2.0 licensed. The downloaded model directory is about 2.3GB:

- `model.safetensors`: about 1.7GB
- `speech_tokenizer/model.safetensors`: about 651MB

Model files live in `backend/models/` and are intentionally ignored by Git. Do not commit model weights to GitHub.

Download the model after installing the backend environment:

```bash
npm run backend:download-model
```

That script runs:

```bash
cd backend
.venv/bin/hf download Qwen/Qwen3-TTS-12Hz-0.6B-Base \
  --local-dir models/Qwen3-TTS-12Hz-0.6B-Base
```

The backend also accepts `QWEN_TTS_MODEL` if you want to point to another local model directory or Hugging Face model id.

## Setup

```bash
npm install
npm run backend:install
npm run backend:download-model
```

The Qwen runtime expects system `ffmpeg` and `sox` binaries.

On macOS:

```bash
brew install ffmpeg sox
```

## Run

Start the local TTS server:

```bash
npm run backend:dev
```

Start the Next.js app in another terminal:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Local API

- `POST http://localhost:8000/analyze`: uploads a reference audio sample and transcript, normalizes it to WAV, and returns a `sessionId`.
- `POST http://localhost:8000/synthesize`: runs Qwen3-TTS locally with the analyzed voice session and returns a WAV file.

No external TTS API is used.

## GitHub Notes

Large generated files are excluded from Git:

- `backend/models/`
- `backend/.venv/`
- `backend/storage/`

Clone the repository, run the setup commands, and download the model from Hugging Face locally before starting the backend.
