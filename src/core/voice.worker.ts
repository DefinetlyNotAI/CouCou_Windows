import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/vendor/onnx/";
  env.backends.onnx.wasm.numThreads = 1;
}
let recognizer: Promise<AutomaticSpeechRecognitionPipeline> | undefined;
let speaker: Promise<KokoroTTS> | undefined;
const worker = self as unknown as Worker;
worker.onmessage = async ({ data }) => {
  const { id, mode, text, audio } = data;
  const progress = (event: { status: string; file?: string; progress?: number }) => {
    worker.postMessage({ id, progress: `${event.status === "progress" ? "Downloading" : "Loading"} voice models${event.progress == null ? "" : ` · ${Math.round(event.progress)}%`}` });
  };
  try {
    if (mode === "listen" || mode === "prepare") {
      recognizer ??= pipeline<"automatic-speech-recognition">("automatic-speech-recognition", "onnx-community/whisper-base", { dtype: "q8", device: "wasm", progress_callback: progress });
      const model = await recognizer;
      if (mode === "listen") {
        const result = await model(audio, { task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
        worker.postMessage({ id, text: Array.isArray(result) ? result.map(item => item.text).join(" ") : result.text });
        return;
      }
    }
    speaker ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm", progress_callback: progress });
    const model = await speaker;
    if (mode === "prepare") {
      worker.postMessage({ id, progress: "Preparing English voice…" });
      await model.generate("Hello. I'm Mochi.", { voice: "af_heart" });
    }
    if (mode === "speak") {
      worker.postMessage({ id, progress: "Synthesizing voice…" });
      for await (const { audio: output } of model.stream(text, { voice: "af_heart" })) {
        worker.postMessage({ id, progress: "Speaking…", audio: output.audio, rate: output.sampling_rate }, [output.audio.buffer]);
      }
    }
    worker.postMessage({ id, done: true });
  } catch (error) {
    if (mode === "listen" || mode === "prepare") recognizer = undefined;
    speaker = undefined;
    worker.postMessage({ id, error: String(error) });
  }
};
