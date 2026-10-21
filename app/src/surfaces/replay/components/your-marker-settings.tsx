import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";
import { ImagePlus } from "lucide-react";
import {
  DEFAULT_REPLAY_MARKER,
  getReplayMarker,
  saveReplayMarker,
  subscribeReplayMarker,
  type ReplayMarkerPreference,
} from "@/data/replay-marker-preference";
import {
  dragPhotoCrop,
  photoCropRectangle,
  reduceMarkerPhoto,
  type MarkerPhotoState,
  type PhotoCrop,
} from "@/surfaces/replay/playback/marker-photo-state";
import { Button } from "@/ui/button";
import { SegmentedControl } from "@/ui/segmented-control";
import "./your-marker-settings.css";

export function YourMarkerSettings() {
  const preference = useSyncExternalStore(
    subscribeReplayMarker,
    getReplayMarker,
    () => DEFAULT_REPLAY_MARKER,
  );
  const [state, dispatch] = useReducer(reduceMarkerPhoto, {
    phase: "idle",
  } satisfies MarkerPhotoState);
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const previousPhase = useRef(state.phase);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const sequence = useRef(0);
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop } | null>(null);
  const release = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    imageRef.current = null;
  };
  useEffect(
    () => () => {
      sequence.current += 1;
      release();
    },
    [],
  );

  useEffect(() => {
    if (previousPhase.current === state.phase) return;
    previousPhase.current = state.phase;
    if (state.phase === "cropping") editorRef.current?.focus();
    if (state.phase === "idle") uploadButtonRef.current?.focus();
  }, [state.phase]);

  const choosePhoto = async (file: File) => {
    const requestId = ++sequence.current;
    release();
    dispatch({ type: "uploadStarted", requestId });
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("Choose a JPG, PNG, or WebP photo.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a photo smaller than 10 MB.");
      const image = new Image();
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      image.src = url;
      await image.decode();
      if (sequence.current !== requestId) return;
      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 24_000_000
      )
        throw new Error("Choose a photo up to 24 megapixels.");
      imageRef.current = image;
      dispatch({
        type: "photoLoaded",
        requestId,
        source: { url, width: image.naturalWidth, height: image.naturalHeight },
      });
    } catch (error) {
      if (sequence.current !== requestId) return;
      release();
      dispatch({
        type: "uploadFailed",
        requestId,
        message:
          error instanceof Error && error.name !== "EncodingError"
            ? error.message
            : "This photo could not be opened. Try a different image.",
      });
    }
  };
  const cancel = () => {
    sequence.current += 1;
    release();
    dispatch({ type: "editingCancelled" });
  };
  const save = (next: ReplayMarkerPreference) => {
    try {
      saveReplayMarker(next);
      dispatch({ type: "photoSaved" });
      return true;
    } catch (error) {
      dispatch({
        type: "saveFailed",
        message:
          error instanceof Error
            ? error.message
            : "The marker could not be saved.",
      });
      return false;
    }
  };
  const usePhoto = () => {
    if (state.phase !== "cropping" || !imageRef.current) return;
    try {
      const rect = photoCropRectangle(state.source, state.crop);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser could not crop this photo.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(
        imageRef.current,
        rect.x,
        rect.y,
        rect.size,
        rect.size,
        0,
        0,
        256,
        256,
      );
      if (save({ kind: "photo", photo: canvas.toDataURL("image/jpeg", 0.88) }))
        release();
    } catch (error) {
      dispatch({
        type: "saveFailed",
        message:
          error instanceof Error
            ? error.message
            : "The photo could not be cropped.",
      });
    }
  };
  const rect =
    state.phase === "cropping"
      ? photoCropRectangle(state.source, state.crop)
      : undefined;
  return (
    <section className="your-marker-settings" aria-label="Your marker">
      <div className="your-marker-heading">
        {preference.kind === "photo" ? (
          <img
            src={preference.photo}
            className="your-marker-thumbnail"
            alt="Your saved marker"
          />
        ) : (
          <span className="your-marker-dot" aria-hidden="true" />
        )}
        <div>
          <h3>Your marker</h3>
          <p>Saved in this browser for every replay and course preview.</p>
        </div>
      </div>
      {preference.photo ? (
        <SegmentedControl
          label="Marker style"
          value={preference.kind}
          options={[
            ["photo", "Photo"],
            ["dot", "Dot"],
          ]}
          disabled={state.phase !== "idle"}
          onChange={(kind) =>
            save(
              kind === "photo"
                ? { kind, photo: preference.photo! }
                : { kind: "dot", photo: preference.photo },
            )
          }
        />
      ) : null}
      <input
        ref={inputRef}
        id={fileId}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Upload marker photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choosePhoto(file);
        }}
      />
      {state.phase === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            ref={uploadButtonRef}
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            {preference.photo ? "Change photo" : "Upload photo"}
          </Button>
          {preference.photo ? (
            <Button variant="ghost" onClick={() => save({ kind: "dot" })}>
              Remove photo
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.phase === "loading" ? (
        <div>
          <p role="status">Opening photo…</p>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {state.phase === "cropping" && rect ? (
        <div
          ref={editorRef}
          className="your-marker-editor"
          tabIndex={-1}
          aria-label="Crop your photo"
        >
          <p>Drag to frame your photo, or use the sliders.</p>
          <div
            className="your-marker-crop"
            role="img"
            aria-label="Circular marker crop preview"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                crop: state.crop,
              };
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              dispatch({
                type: "cropAdjusted",
                crop: dragPhotoCrop(
                  state.source,
                  drag.current.crop,
                  event.clientX - drag.current.x,
                  event.clientY - drag.current.y,
                  event.currentTarget.clientWidth,
                ),
              });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          >
            <img
              src={state.source.url}
              alt=""
              draggable={false}
              style={{
                width: `${(state.source.width / rect.size) * 100}%`,
                height: `${(state.source.height / rect.size) * 100}%`,
                left: `${(-rect.x / rect.size) * 100}%`,
                top: `${(-rect.y / rect.size) * 100}%`,
              }}
            />
          </div>
          {(
            [
              ["zoom", "Zoom photo", 1, 3],
              ["x", "Horizontal position", 0, 1],
              ["y", "Vertical position", 0, 1],
            ] as const
          ).map(([axis, label, min, max]) => (
            <label key={axis} className="your-marker-slider">
              <span>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step="0.01"
                value={state.crop[axis]}
                disabled={
                  (axis === "x" && state.source.width === rect.size) ||
                  (axis === "y" && state.source.height === rect.size)
                }
                onChange={(event) =>
                  dispatch({
                    type: "cropAdjusted",
                    crop: { ...state.crop, [axis]: Number(event.target.value) },
                  })
                }
              />
            </label>
          ))}
          <div className="flex gap-2">
            <Button onClick={usePhoto}>Use photo</Button>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {state.phase !== "loading" && state.error ? (
        <p role="alert">{state.error}</p>
      ) : null}
      <p className="your-marker-privacy">
        Your photo stays in this browser. JPG, PNG, or WebP, up to 10 MB.
      </p>
    </section>
  );
}
