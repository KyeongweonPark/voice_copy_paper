"use client";

import {
  AudioLines,
  Check,
  CircleStop,
  FileAudio,
  Loader2,
  Mic,
  Play,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

const sampleTexts = [
  {
    title: "차분한 설명",
    text: "오늘은 맑은 공기와 조용한 방 안에서, 또렷하고 자연스러운 목소리로 이 문장을 읽어 봅니다.",
  },
  {
    title: "감정 변화",
    text: "처음에는 낮고 편안하게 시작하고, 중간에는 밝게 웃으며 말한 뒤, 마지막은 천천히 마무리합니다.",
  },
  {
    title: "긴 문장",
    text: "목소리의 높낮이와 속도, 숨을 쉬는 간격까지 잘 담기도록 너무 서두르지 말고 한 문장씩 분명하게 읽어 주세요.",
  },
];

const analysisSteps = ["음질 점검", "발화 패턴 추출", "톤 프로필 생성", "합성 준비"];
const ttsServerUrl = process.env.NEXT_PUBLIC_TTS_SERVER_URL ?? "http://localhost:8000";

type VoiceSource = {
  file?: File;
  name: string;
  url?: string;
  durationLabel: string;
  source: "recording" | "upload";
};

type AnalysisState = "idle" | "ready" | "analyzing" | "done";

export default function Home() {
  const [selectedSample, setSelectedSample] = useState(0);
  const [consent, setConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceSource, setVoiceSource] = useState<VoiceSource | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [voiceSessionId, setVoiceSessionId] = useState("");
  const [generatedText, setGeneratedText] = useState(
    "안녕하세요. 이제 준비된 음성 프로필로 원하는 문장을 자연스럽게 읽어 드릴게요.",
  );
  const [voiceStyle, setVoiceStyle] = useState("natural");
  const [generationState, setGenerationState] = useState<"idle" | "running" | "done">("idle");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState("");
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingSecondsRef = useRef(0);

  const sample = sampleTexts[selectedSample];
  const canAnalyze = Boolean(voiceSource && consent && analysisState !== "analyzing");
  const canGenerate = analysisState === "done" && Boolean(voiceSessionId) && generatedText.trim().length > 0;

  const activeStep = useMemo(() => {
    if (analysisState === "done") return analysisSteps.length;
    return Math.min(analysisSteps.length - 1, Math.floor(analysisProgress / 26));
  }, [analysisProgress, analysisState]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      recordingSecondsRef.current += 1;
      setRecordingSeconds(recordingSecondsRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (voiceSource?.url) URL.revokeObjectURL(voiceSource.url);
    };
  }, [voiceSource]);

  useEffect(() => {
    return () => {
      if (generatedAudioUrl) URL.revokeObjectURL(generatedAudioUrl);
    };
  }, [generatedAudioUrl]);

  const durationLabel = (seconds: number) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
    const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${rest}`;
  };

  const resetAnalysis = () => {
    setAnalysisState("ready");
    setAnalysisProgress(0);
    setVoiceSessionId("");
    setGenerationState("idle");
    setGenerationProgress(0);
    setGeneratedAudioUrl("");
  };

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 마이크 녹음을 지원하지 않습니다.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `voice-sample-${Date.now()}.webm`, { type: blob.type });
        const url = URL.createObjectURL(blob);

        setVoiceSource({
          file,
          name: "브라우저 녹음 샘플",
          url,
          durationLabel: durationLabel(recordingSecondsRef.current),
          source: "recording",
        });
        resetAnalysis();
        stream.getTracks().forEach((track) => track.stop());
      };

      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      setIsRecording(true);
      recorder.start();
    } catch {
      setError("마이크 권한을 허용한 뒤 다시 시도해 주세요.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setVoiceSource({
      file,
      name: file.name,
      url,
      durationLabel: `${Math.max(1, Math.round(file.size / 180000))}분 미만`,
      source: "upload",
    });
    setError("");
    resetAnalysis();
  };

  const analyzeVoice = async () => {
    if (!canAnalyze) return;
    if (!voiceSource?.file) {
      setError("분석할 오디오 샘플이 없습니다.");
      return;
    }

    setAnalysisState("analyzing");
    setAnalysisProgress(0);
    setGenerationState("idle");
    setGeneratedAudioUrl("");
    setError("");

    const progressTimer = window.setInterval(() => {
      setAnalysisProgress((progress) => Math.min(92, progress + 4));
    }, 160);

    try {
      const formData = new FormData();
      formData.append("audio", voiceSource.file as File);
      formData.append("ref_text", sample.text);
      formData.append("consent", String(consent));

      const response = await fetch(`${ttsServerUrl}/analyze`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "목소리 분석에 실패했습니다.");
      }

      const payload = (await response.json()) as { sessionId: string };
      setVoiceSessionId(payload.sessionId);
      setAnalysisProgress(100);
      setAnalysisState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "목소리 분석에 실패했습니다.");
      setAnalysisState("ready");
      setAnalysisProgress(0);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const generateVoice = async () => {
    if (!canGenerate) return;

    setGenerationState("running");
    setGenerationProgress(0);
    setGeneratedAudioUrl("");
    setError("");

    const progressTimer = window.setInterval(() => {
      setGenerationProgress((progress) => Math.min(94, progress + 3));
    }, 220);

    try {
      const formData = new FormData();
      formData.append("session_id", voiceSessionId);
      formData.append("text", generatedText);
      formData.append("language", "Korean");
      formData.append("style", voiceStyle);

      const response = await fetch(`${ttsServerUrl}/synthesize`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "음성 생성에 실패했습니다.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setGeneratedAudioUrl(url);
      setGenerationProgress(100);
      setGenerationState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "음성 생성에 실패했습니다.");
      setGenerationState("idle");
      setGenerationProgress(0);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const previewWithBrowserVoice = () => {
    if (!generatedText.trim() || typeof window === "undefined" || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(generatedText);
    utterance.lang = "ko-KR";
    utterance.rate = voiceStyle === "slow" ? 0.82 : voiceStyle === "bright" ? 1.04 : 0.94;
    utterance.pitch = voiceStyle === "deep" ? 0.82 : voiceStyle === "bright" ? 1.12 : 1;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <main className="min-h-screen bg-[#f6f7f4] text-[#17211c]">
      <section className="border-b border-[#dce2d4] bg-[#fbfcf8]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-8 lg:px-10">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md bg-[#1f5e45] text-white">
                <AudioLines size={22} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1f5e45]">Voice Studio</p>
                <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">목소리 샘플링 웹앱</h1>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-md border border-[#cad4c4] bg-white px-3 py-2 text-sm text-[#44544b] sm:flex">
              <ShieldCheck size={17} />
              동의 기반 프로토타입
            </div>
          </nav>

          <div className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
            <section className="rounded-lg border border-[#d8dfd1] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-[#23644a]">1. 샘플 텍스트 읽기</p>
                <h2 className="text-xl font-semibold">녹음할 문장을 고르고 또렷하게 읽어 주세요</h2>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {sampleTexts.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => setSelectedSample(index)}
                    className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition ${
                      selectedSample === index
                        ? "border-[#1f5e45] bg-[#edf6ee] text-[#173f31]"
                        : "border-[#dce2d4] bg-[#fbfcf8] text-[#526057] hover:border-[#9eb3a0]"
                    }`}
                  >
                    {item.title}
                  </button>
                ))}
              </div>

              <blockquote className="mt-4 rounded-md border border-[#cfd8c7] bg-[#f7faf2] p-5 text-lg leading-8 text-[#21342b]">
                {sample.text}
              </blockquote>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`inline-flex h-12 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white transition ${
                    isRecording ? "bg-[#a33c2f] hover:bg-[#8e3026]" : "bg-[#1f5e45] hover:bg-[#174936]"
                  }`}
                >
                  {isRecording ? <CircleStop size={18} /> : <Mic size={18} />}
                  {isRecording ? "녹음 중지" : "녹음 시작"}
                </button>
                <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#cbd5c4] bg-white px-5 text-sm font-semibold text-[#26362d] transition hover:bg-[#f1f4ee]">
                  <Upload size={18} />
                  오디오 업로드
                  <input className="sr-only" type="file" accept="audio/*" onChange={handleUpload} />
                </label>
              </div>

              <div className="mt-4 min-h-9 text-sm text-[#58675e]">
                {isRecording && <span className="font-semibold text-[#a33c2f]">녹음 시간 {durationLabel(recordingSeconds)}</span>}
                {error && <span className="text-[#a33c2f]">{error}</span>}
                {!isRecording && !error && "권장 샘플 길이는 30초에서 2분입니다."}
              </div>
            </section>

            <section className="rounded-lg border border-[#d8dfd1] bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#23644a]">2. 샘플 확인 및 분석</p>
                  <h2 className="mt-1 text-xl font-semibold">업로드된 목소리 프로필</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setVoiceSource(null);
                    setAnalysisState("idle");
                    setAnalysisProgress(0);
                    setVoiceSessionId("");
                    setGenerationState("idle");
                    setGenerationProgress(0);
                    setGeneratedAudioUrl("");
                  }}
                  className="inline-flex size-10 items-center justify-center rounded-md border border-[#d5dccf] bg-white text-[#526057] hover:bg-[#f3f5f0]"
                  title="초기화"
                  aria-label="초기화"
                >
                  <RefreshCcw size={17} />
                </button>
              </div>

              <div className="mt-5 rounded-md border border-[#dce2d4] bg-[#fbfcf8] p-4">
                {voiceSource ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-11 items-center justify-center rounded-md bg-[#e4efe5] text-[#1f5e45]">
                        <FileAudio size={22} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{voiceSource.name}</p>
                        <p className="text-sm text-[#617068]">
                          {voiceSource.source === "recording" ? "녹음 샘플" : "업로드 파일"} · {voiceSource.durationLabel}
                        </p>
                      </div>
                    </div>
                    {voiceSource.url && <audio className="w-full" controls src={voiceSource.url} />}
                  </div>
                ) : (
                  <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center text-[#66746b]">
                    <FileAudio size={32} />
                    <p className="text-sm">녹음하거나 오디오 파일을 업로드하면 여기에 표시됩니다.</p>
                  </div>
                )}
              </div>

              <label className="mt-4 flex items-start gap-3 rounded-md border border-[#dce2d4] bg-white p-3 text-sm text-[#334139]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-1 size-4 accent-[#1f5e45]"
                />
                <span>본인 목소리이거나 명시적으로 허가받은 음성만 사용합니다.</span>
              </label>

              <button
                type="button"
                disabled={!canAnalyze}
                onClick={analyzeVoice}
                className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#26362d] px-5 text-sm font-semibold text-white transition enabled:hover:bg-[#17211c] disabled:cursor-not-allowed disabled:bg-[#aeb8ad]"
              >
                {analysisState === "analyzing" ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                {analysisState === "done" ? "분석 다시 실행" : "목소리 분석 시작"}
              </button>

              <div className="mt-5">
                <div className="h-2 overflow-hidden rounded-full bg-[#e6eadf]">
                  <div className="h-full rounded-full bg-[#1f5e45] transition-all" style={{ width: `${analysisProgress}%` }} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {analysisSteps.map((step, index) => (
                    <div
                      key={step}
                      className={`rounded-md border px-3 py-3 text-sm ${
                        analysisState === "done" || index <= activeStep
                          ? "border-[#b7cab8] bg-[#edf6ee] text-[#1f5e45]"
                          : "border-[#dce2d4] bg-[#fbfcf8] text-[#748176]"
                      }`}
                    >
                      <div className="mb-2 flex h-5 items-center">
                        {analysisState === "done" || index < activeStep ? <Check size={16} /> : <span className="h-2 w-2 rounded-full bg-current" />}
                      </div>
                      {step}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-6 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:px-10">
        <aside className="rounded-lg border border-[#d8dfd1] bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-[#23644a]">프로필 상태</p>
          <h2 className="mt-1 text-xl font-semibold">합성 준비도</h2>

          <div className="mt-5 space-y-3">
            {[
              ["샘플 등록", Boolean(voiceSource)],
              ["사용 동의", consent],
              ["분석 완료", analysisState === "done"],
            ].map(([label, done]) => (
              <div key={String(label)} className="flex items-center justify-between rounded-md border border-[#dde3d8] px-3 py-3">
                <span className="text-sm font-medium">{label}</span>
                <span className={`flex size-6 items-center justify-center rounded-full ${done ? "bg-[#1f5e45] text-white" : "bg-[#e7ebe3] text-[#778276]"}`}>
                  <Check size={14} />
                </span>
              </div>
            ))}
          </div>

            <div className="mt-5 rounded-md bg-[#eef4e9] p-4 text-sm leading-6 text-[#405044]">
            외부 음성 API를 쓰지 않고 로컬 FastAPI 서버의 Qwen3-TTS 0.6B Base 모델로 처리합니다. 생성 미리듣기는
            브라우저 기본 음성이고, 생성 결과는 로컬 모델 WAV 파일로 표시됩니다.
          </div>
        </aside>

        <section className="rounded-lg border border-[#d8dfd1] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-[#23644a]">3. 원하는 텍스트로 음성 생성</p>
            <h2 className="text-xl font-semibold">읽게 만들 문장을 입력하세요</h2>
          </div>

          <textarea
            value={generatedText}
            onChange={(event) => {
              setGeneratedText(event.target.value);
              setGenerationState("idle");
            }}
            className="mt-5 min-h-40 w-full resize-y rounded-md border border-[#cfd8c7] bg-[#fbfcf8] p-4 text-base leading-7 outline-none transition focus:border-[#1f5e45] focus:ring-4 focus:ring-[#dceade]"
            maxLength={500}
            placeholder="생성할 문장을 입력하세요."
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex rounded-md border border-[#cfd8c7] bg-[#fbfcf8] p-1">
              {[
                ["natural", "자연스럽게"],
                ["bright", "밝게"],
                ["deep", "낮게"],
                ["slow", "천천히"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setVoiceStyle(value)}
                  className={`h-9 rounded px-3 text-sm font-semibold transition ${
                    voiceStyle === value ? "bg-[#1f5e45] text-white" : "text-[#516159] hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-sm text-[#68766d]">{generatedText.length}/500자</span>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={!canGenerate || generationState === "running"}
              onClick={generateVoice}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-[#1f5e45] px-5 text-sm font-semibold text-white transition enabled:hover:bg-[#174936] disabled:cursor-not-allowed disabled:bg-[#aeb8ad]"
            >
              {generationState === "running" ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
              음성 생성
            </button>
            <button
              type="button"
              disabled={!generatedText.trim()}
              onClick={previewWithBrowserVoice}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-[#c7d2c1] bg-white px-5 text-sm font-semibold text-[#26362d] transition enabled:hover:bg-[#f1f4ee] disabled:cursor-not-allowed disabled:text-[#9ba59b]"
            >
              <Play size={18} />
              미리듣기
            </button>
          </div>

          <div className="mt-5 rounded-md border border-[#dce2d4] bg-[#fbfcf8] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#334139]">생성 결과</p>
                <p className="mt-1 text-sm text-[#68766d]">
                  {generationState === "done"
                    ? "로컬 모델 생성이 완료되었습니다."
                    : "분석 완료 후 생성 버튼을 누르면 결과가 준비됩니다."}
                </p>
              </div>
              <span className="text-sm font-semibold text-[#1f5e45]">{generationProgress}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e6eadf]">
              <div className="h-full rounded-full bg-[#b07b3b] transition-all" style={{ width: `${generationProgress}%` }} />
            </div>
            {generatedAudioUrl && <audio className="mt-4 w-full" controls src={generatedAudioUrl} />}
          </div>
        </section>
      </section>
    </main>
  );
}
