import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

env.allowLocalModels = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = "/vendor/onnx/";
  env.backends.onnx.wasm.numThreads = 1;
}
let recognizer: Promise<AutomaticSpeechRecognitionPipeline> | undefined;
let speaker: Promise<KokoroTTS> | undefined;
const worker = self as unknown as Worker;
async function transcribe(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array) {
  const config = model.model.generation_config as { decoder_start_token_id?: number; lang_to_id?: Record<string, number> } | null;
  if (!config?.lang_to_id || !config.decoder_start_token_id) throw new Error("The speech model does not support language detection.");
  const features = await model.processor(audio.slice(0, 16000 * 30));
  const output: Record<string, Tensor> = await model.model.forward({ ...features, decoder_input_ids: new Tensor("int64", [BigInt(config.decoder_start_token_id)], [1, 1]) });
  let language = "", highest = Number.NEGATIVE_INFINITY;
  for (const [token, id] of Object.entries(config.lang_to_id)) {
    const score = Number(output.logits.data[id]);
    if (score > highest) { highest = score; language = token.replace(/^<\||\|>$/g, ""); }
  }
  for (const tensor of Object.values(output)) if (tensor instanceof Tensor) tensor.dispose();
  if (!language) throw new Error("Could not detect the spoken language. Please try again.");
  const result = await model(audio, { language, task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
  return Array.isArray(result) ? result.map(item => item.text).join(" ") : result.text;
}
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
        worker.postMessage({ id, text: await transcribe(model, audio) });
        return;
      }
    }
    speaker ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm", progress_callback: progress });
    const model = await speaker;
    if (mode === "prepare") {
      worker.postMessage({ id, progress: "Preparing English voice…" });
      const sample = await model.generate("Hello. I'm Mochi.", { voice: "af_heart" });
      const audio = new Float32Array(Math.floor(sample.audio.length * 16000 / sample.sampling_rate));
      for (let i = 0; i < audio.length; i++) audio[i] = sample.audio[Math.floor(i * sample.sampling_rate / 16000)];
      worker.postMessage({ id, progress: "Preparing speech recognition…" });
      await transcribe(await recognizer!, audio);
    }
    if (mode === "speak") {
      worker.postMessage({ id, progress: "Synthesizing voice…" });
      const sentences = new TextSplitterStream();
      sentences.push(text);
      sentences.close();
      for await (const { audio: output } of model.stream(sentences, { voice: "af_heart" })) {
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
