export {};
// Load only after a query. Register the listener BEFORE asynchronous imports,
// otherwise the first message can arrive while the runtime is downloading.
const runtimeUrl =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
async function createModel() {
  const { env, pipeline } = (await import(
    /* @vite-ignore */ runtimeUrl
  )) as typeof import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.backends.onnx.wasm!.numThreads = 1;
  return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "q8",
    device: "wasm",
  });
}
let instance: ReturnType<typeof createModel> | undefined;
self.onmessage = async ({
  data,
}: MessageEvent<{ id: number; text: string; texts?: string[] }>) => {
  try {
    instance ??= createModel();
    const embed = await instance;
    if (data.texts) {
      const vectors: number[][] = [];
      for (const text of data.texts.slice(0, 81)) {
        const output = await embed(text.slice(0, 1400), {
          pooling: "mean",
          normalize: true,
        });
        vectors.push(Array.from(output.data) as number[]);
      }
      self.postMessage({ id: data.id, vectors });
      return;
    }
    const result = await embed(data.text, { pooling: "mean", normalize: true });
    self.postMessage({ id: data.id, vector: Array.from(result.data) });
  } catch (error) {
    console.warn(
      "Finder embedding worker:",
      error instanceof Error ? error.message : "unavailable",
    );
    instance = undefined;
    self.postMessage({ id: data.id, error: true });
  }
};
