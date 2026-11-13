import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { RouteAnnotation } from "@/domain/route";
import { context2d } from "@/labs/overland/engine/canvas";
import { ATTRIBUTION_BAND_PX } from "@/labs/overland/model/realm-layout";
import { Key, PixelLabel } from "@/labs/overland/overland-ui";

// Her photos in the pixel world: a small polaroid drawn from the photo in
// code, nearest-neighbour, and a viewer that shows the real photo with her
// caption. An editorial annotation says so on its face (CONTEXT.md, s. 4).

/** The photo's short name: her title, or else her caption. */
export function photoLabel(annotation: RouteAnnotation) {
  return annotation.title ?? annotation.body;
}

/** The photo, at most 20 pixels on its long side, in a white frame with a deeper foot. */
function paintPolaroid(canvas: HTMLCanvasElement, image: HTMLImageElement | null, aspect: number) {
  const long = 20;
  const w = aspect >= 1 ? long : Math.max(8, Math.round(long * aspect));
  const h = aspect >= 1 ? Math.max(8, Math.round(long / aspect)) : long;
  canvas.width = w + 4;
  canvas.height = h + 8;
  const context = context2d(canvas);
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#1d2433";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f8f6ee";
  context.fillRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.fillStyle = "#3a4560";
  context.fillRect(2, 2, w, h);
  if (image) context.drawImage(image, 2, 2, w, h);
}

export function PixelPolaroid({ annotation, onOpen, tilt = 0, scale = 3 }: { annotation: RouteAnnotation; onOpen: () => void; tilt?: number; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const media = annotation.media!;
  const aspect = media.width / media.height;
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paintPolaroid(canvas, null, aspect);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => paintPolaroid(canvas, image, aspect);
    image.src = media.thumbUrl;
    return () => {
      image.onload = null;
    };
  }, [aspect, media.thumbUrl]);
  return (
    <button
      aria-label={`Photo: ${photoLabel(annotation)}`}
      className="overland-polaroid"
      data-annotation-id={annotation.id}
      data-testid="overland-polaroid"
      onClick={onOpen}
      style={{ transform: `rotate(${tilt}deg)` }}
      type="button"
    >
      <canvas aria-hidden="true" className="overland-pixels" ref={ref} style={{ width: (aspect >= 1 ? 24 : Math.round(20 * aspect) + 4) * scale, height: "auto" }} />
    </button>
  );
}

/**
 * The real photo, with her title and caption, in a dialog above everything
 * of ours and clear of the attribution band. Escape or Close returns focus
 * to whatever opened it.
 */
export function PhotoViewer({ annotation, onClose }: { annotation: RouteAnnotation; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, []);
  const media = annotation.media!;
  const titleId = `overland-photo-${annotation.id}`;
  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="overland-viewer"
      data-overland-viewer=""
      data-testid="overland-photo-viewer"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      role="dialog"
      style={{ bottom: ATTRIBUTION_BAND_PX }}
    >
      <figure className="overland-viewer-figure">
        <img alt={photoLabel(annotation)} className="overland-viewer-image" height={media.height} src={media.url} width={media.width} />
        <figcaption className="overland-viewer-caption">
          {annotation.title ? (
            <p className="overland-viewer-title" id={titleId}>
              {annotation.title}
            </p>
          ) : (
            <p className="sr-only" id={titleId}>
              Photo
            </p>
          )}
          <p>{annotation.body}</p>
          {annotation.evidence === "hypothesis" ? <p className="overland-viewer-evidence">Editorial</p> : null}
        </figcaption>
      </figure>
      <Key className="overland-viewer-close" label="Close photo" onClick={onClose} ref={closeRef}>
        <PixelLabel scale={2} text="Close" />
      </Key>
    </div>,
    document.body,
  );
}
