// Parallel runner for the chat-driven media generation flow.
// Image scenes use `anything-api` (Wan + server-side daily quota); video stays
// on the existing media-video flow.
// together and reports progress via callbacks so the UI updates as each result lands.

import { supabase } from "@/integrations/supabase/client";
import type { MediaPlan, MediaPlanScene } from "@/components/chat/media/MediaPlanCard";
import type { MediaSceneResult } from "@/components/chat/media/MediaResultCard";
import { getRunwayVideoPolicy } from "@/lib/runwayModelPolicy";

// Free and paid chat image generation use Wan through the server-side image
// router. The router owns the free daily quota and never trusts this client slug.
const IMAGE_FN = "anything-api";
const FIXED_IMAGE_SLUG = "wan2.7-image";

// Video job pacing depends on the provider. Alibaba Wan runs ~5–6 min end
// to end, so we show a visible countdown before polling. deAPI usually
// finishes within seconds, so we skip the wait and poll aggressively.
const ALIBABA_POLL_INTERVAL_MS = 5_000;
const ALIBABA_POLL_MAX_MS = 15 * 60_000;
const DEAPI_POLL_INTERVAL_MS = 3_000;
const DEAPI_POLL_MAX_MS = 5 * 60_000;

interface ScenePartialCb {
  (index: number, previewDataUrl: string, progress: number): void;
}

/**
 * Drives a synthetic progress ticker for non-streaming generations so the UI
 * shows ChatGPT-style live progress for every model.
 * Approaches but never reaches 0.95 until the real result arrives.
 */
function startProgressTicker(
  sceneIndex: number,
  estimatedMs: number,
  onPartial: ScenePartialCb | undefined,
): () => void {
  if (!onPartial) return () => {};
  const started = Date.now();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const elapsed = Date.now() - started;
    // Easing: fast at first, asymptotic to 0.95
    const p = Math.min(0.95, 1 - Math.exp(-elapsed / estimatedMs));
    onPartial(sceneIndex, "", p);
  };
  tick();
  const id = window.setInterval(tick, 600);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}

/** Last-resort image models: always-available slugs tried when the chosen one fails. */
const IMAGE_FALLBACK_SLUGS = ["deapi-flux-schnell"];

async function requestImage(
  scene: MediaPlanScene,
  modelSlug: string,
  refs: string[],
  aspectRatio?: string,
): Promise<string> {
  const routerModelSlug = modelSlug === "gen4_image_turbo" ? "runway-gen4-image-turbo" : modelSlug;
  if (
    /runway[-_]gen4[-_]image[-_]turbo|^gen4_image_turbo$/i.test(routerModelSlug) &&
    refs.length === 0
  ) {
    throw new Error("selected image model requires a reference image");
  }
  const { data, error } = await supabase.functions.invoke(IMAGE_FN, {
    body: {
      prompt: scene.prompt,
      model_slug: routerModelSlug,
      model: routerModelSlug,
      num_images: 1,
      aspect_ratio: aspectRatio,
      ...(/^(?:runway[-_])?(gpt_image_2_5_flare|gpt_image_2_5_sunburst|seedream5_pro|gpt_image_2|grok_imagine_image_2|muse_image|gemini_image3\.1_flash|gen4_image_turbo)$/i.test(
        routerModelSlug,
      )
        ? { resolution: "1K" }
        : {}),
      ...(refs.length > 0
        ? {
            reference_image_url: refs[0],
            image_url: refs[0],
            reference_image_urls: refs,
          }
        : {}),
    },
  });
  if (error) {
    let detail = error.message || "image gen failed";
    try {
      const payload = await (error as any).context?.clone?.().json?.();
      detail = payload?.message || payload?.error || detail;
    } catch {
      // FunctionsHttpError.context is not present in older supabase-js builds.
    }
    throw new Error(detail);
  }
  if (data?.paywall) {
    const e = new Error(data.message || "Upgrade required");
    (e as any).paywall = true;
    throw e;
  }
  if (data?.error) throw new Error(data.message || data.error);
  const url = data?.image_url || (Array.isArray(data?.image_urls) ? data.image_urls[0] : null);
  if (!url) throw new Error("no image returned");
  return url;
}

async function generateImageScene(
  scene: MediaPlanScene,
  modelSlug: string,
  onPartial?: ScenePartialCb,
  aspectRatio?: string,
): Promise<string> {
  // All image models go through the image router edge function.
  const stopTicker = startProgressTicker(scene.index, 18_000, onPartial);
  const refs: string[] = Array.isArray((scene as any).reference_image_urls)
    ? ((scene as any).reference_image_urls as string[])
    : scene.reference_image_url
      ? [scene.reference_image_url]
      : [];
  // Never silently replace a requested Runway image with another provider.
  // Other models retain their existing fallback chain.
  void modelSlug;
  void IMAGE_FALLBACK_SLUGS;
  const attempts = [FIXED_IMAGE_SLUG];
  try {
    let lastErr: unknown = null;
    for (const slug of attempts) {
      try {
        const url = await requestImage(scene, slug, refs, aspectRatio);
        onPartial?.(scene.index, url, 1);
        return url;
      } catch (e) {
        if ((e as any)?.paywall) throw e;
        // Reference-only models fall through to the compatible fallback list.
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("image gen failed");
  } finally {
    stopTicker();
  }
}

async function generateVideoScene(
  scene: MediaPlanScene,
  modelSlug: string,
  onPartial?: ScenePartialCb,
  aspectRatio?: string,
  onCountdown?: (index: number, endsAt: number | null) => void,
): Promise<string> {
  const body: Record<string, unknown> = {
    prompt: scene.prompt,
    model_slug: modelSlug,
    duration: Math.min(
      scene.duration_seconds || 5,
      getRunwayVideoPolicy(modelSlug)?.maxDuration ?? Infinity,
    ),
    aspect_ratio: scene.aspect_ratio || aspectRatio,
  };
  const runwayPolicy = getRunwayVideoPolicy(modelSlug);
  if (runwayPolicy?.resolution) body.resolution = runwayPolicy.resolution;
  if (runwayPolicy?.audio === false) body.audio = false;
  if (scene.first_frame_url) body.start_frame = scene.first_frame_url;
  if (scene.last_frame_url) body.end_frame = scene.last_frame_url;

  // Videos are treated as async tasks: no fake percent bar while the provider
  // is rendering. We surface a 5-minute countdown instead (see onCountdown).
  onPartial?.(scene.index, "", NaN);

  // The video service reserves the monthly allowance atomically. Do not
  // consume it here as well or a single video costs two quota slots.
  try {
    const { data, error } = await supabase.functions.invoke("media-video", { body });
    if (error) {
      let detail = error.message || "video gen failed";
      try {
        const payload = await (error as any).context?.clone?.().json?.();
        detail = payload?.message || payload?.error || detail;
      } catch {
        // FunctionsHttpError.context is not present in older supabase-js builds.
      }
      throw new Error(detail);
    }
    if (data?.paywall) throw new Error(data.message || "Upgrade required");
    if (data?.error) throw new Error(data.message || data.error);

    const directUrl = data?.video_url || data?.url;
    if (directUrl) {
      onPartial?.(scene.index, "", 1);
      return String(directUrl);
    }

    const jobId = data?.job_id || data?.id;
    if (!jobId) throw new Error("no video job id");

    // Poll immediately for every provider — no blind waiting. Alibaba Wan
    // tasks keep running server-side, so we just watch until they finish.
    const isDeapi = String(jobId).startsWith("deapi:");
    const pollInterval = isDeapi ? DEAPI_POLL_INTERVAL_MS : ALIBABA_POLL_INTERVAL_MS;
    const pollMax = isDeapi ? DEAPI_POLL_MAX_MS : ALIBABA_POLL_MAX_MS;
    onCountdown?.(scene.index, null);

    const started = Date.now();
    while (Date.now() - started < pollMax) {
      const { data: poll, error: pollErr } = await supabase.functions.invoke("media-video-poll", {
        body: { job_id: jobId },
      });
      if (!pollErr) {
        const status = poll?.status;
        const reported = Number(poll?.progress ?? poll?.percent ?? NaN);
        if (Number.isFinite(reported) && reported > 0) {
          const norm = reported > 1 ? Math.min(0.95, reported / 100) : Math.min(0.95, reported);
          onPartial?.(scene.index, "", norm);
        }
        if (
          status === "complete" ||
          status === "completed" ||
          status === "succeeded" ||
          status === "success"
        ) {
          const u = poll?.video_url || poll?.url || poll?.output_url;
          if (u) {
            onPartial?.(scene.index, "", 1);
            return String(u);
          }
          throw new Error("completed but no URL");
        }
        if (status === "failed" || status === "error" || status === "cancelled") {
          throw new Error(poll?.error || "video job failed");
        }
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }
    throw new Error("timeout");
  } finally {
    onCountdown?.(scene.index, null);
  }
}

export interface RunMediaPlanOptions {
  plan: MediaPlan;
  onSceneStart: (index: number) => void;
  onSceneDone: (result: MediaSceneResult) => void;
  /** Fires with progressive previews (ChatGPT-style) while an image is rendering. */
  onScenePartial?: (index: number, previewUrl: string, progress: number) => void;
  /** For video tasks: timestamp (ms) when the initial ~5 min wait ends, or null to clear. */
  onSceneCountdown?: (index: number, endsAt: number | null) => void;
  shouldCancel?: () => boolean;
}

export async function runMediaPlan(opts: RunMediaPlanOptions): Promise<void> {
  const { plan, onSceneStart, onSceneDone, onScenePartial, onSceneCountdown, shouldCancel } = opts;
  // Keep premium video unlimited at the request level, but never fan out an
  // unbounded number of provider jobs. This is the client-side admission layer
  // until the durable Supabase worker is deployed; the provider must still
  // enforce the authoritative per-user/global limits server-side.
  const concurrency = plan.mode === "video" ? 2 : 4;
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < plan.scenes.length) {
      const scene = plan.scenes[nextIndex++];
      if (shouldCancel?.()) return;
      onSceneStart(scene.index);
      try {
        const url =
          plan.mode === "video"
            ? await generateVideoScene(
                scene,
                plan.modelSlug,
                onScenePartial,
                plan.aspectRatio,
                onSceneCountdown,
              )
            : await generateImageScene(scene, plan.modelSlug, onScenePartial, plan.aspectRatio);
        if (plan.mode === "images" && url) {
          try {
            const { rememberCharacter } = await import("./media/characterMemory");
            rememberCharacter({
              name: plan.originalPrompt || plan.summary,
              descriptor: scene.identity || scene.prompt,
              refUrl: url,
            });
          } catch {
            /* memory is best-effort */
          }
        }
        onSceneDone({
          index: scene.index,
          title: scene.title,
          status: "done",
          url,
          type: plan.mode === "video" ? "video" : "image",
        });
      } catch (e) {
        onSceneDone({
          index: scene.index,
          title: scene.title,
          status: "error",
          error: e instanceof Error ? e.message : "failed",
          type: plan.mode === "video" ? "video" : "image",
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.scenes.length) }, worker));
}

export async function regenerateScene(
  plan: MediaPlan,
  sceneIndex: number,
  onPartial?: (index: number, previewUrl: string, progress: number) => void,
  onCountdown?: (index: number, endsAt: number | null) => void,
): Promise<MediaSceneResult> {
  const scene = plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) throw new Error("scene not found");
  try {
    const url =
      plan.mode === "video"
        ? await generateVideoScene(scene, plan.modelSlug, onPartial, plan.aspectRatio, onCountdown)
        : await generateImageScene(scene, plan.modelSlug, onPartial, plan.aspectRatio);
    return {
      index: scene.index,
      title: scene.title,
      status: "done",
      url,
      type: plan.mode === "video" ? "video" : "image",
    };
  } catch (e) {
    return {
      index: scene.index,
      title: scene.title,
      status: "error",
      error: e instanceof Error ? e.message : "failed",
      type: plan.mode === "video" ? "video" : "image",
    };
  }
}
