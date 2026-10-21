import { describe, expect, it } from "vitest";
import {
  dragPhotoCrop,
  photoCropRectangle,
  reduceMarkerPhoto,
  type MarkerPhotoState,
} from "./marker-photo-state";
const source = { url: "blob:test", width: 600, height: 400 };
const editing: MarkerPhotoState = {
  phase: "cropping",
  requestId: 2,
  source,
  crop: { x: 0.5, y: 0.5, zoom: 1 },
};

describe("marker photo editor", () => {
  it("only accepts the current pending decode", () => {
    const pending = reduceMarkerPhoto(
      { phase: "idle" },
      { type: "uploadStarted", requestId: 2 },
    );
    expect(
      reduceMarkerPhoto(pending, { type: "photoLoaded", requestId: 1, source }),
    ).toBe(pending);
    expect(
      reduceMarkerPhoto(pending, {
        type: "uploadFailed",
        requestId: 1,
        message: "Old error",
      }),
    ).toBe(pending);
    expect(
      reduceMarkerPhoto(pending, { type: "photoLoaded", requestId: 2, source }),
    ).toEqual(editing);
    const cancelled = reduceMarkerPhoto(pending, { type: "editingCancelled" });
    expect(
      reduceMarkerPhoto(cancelled, {
        type: "photoLoaded",
        requestId: 2,
        source,
      }),
    ).toBe(cancelled);
  });
  it("preserves the draft on save failure and permits retry", () => {
    const failed = reduceMarkerPhoto(editing, {
      type: "saveFailed",
      message: "Storage full",
    });
    expect(failed).toEqual({ ...editing, error: "Storage full" });
    expect(reduceMarkerPhoto(failed, { type: "photoSaved" })).toEqual({
      phase: "idle",
    });
  });
  it("does not adjust a crop before a photo is loaded", () => {
    const idle: MarkerPhotoState = { phase: "idle" };
    expect(
      reduceMarkerPhoto(idle, {
        type: "cropAdjusted",
        crop: { zoom: 2, x: 0, y: 1 },
      }),
    ).toBe(idle);
  });
  it("uses the largest centered square at the initial zoom", () => {
    expect(photoCropRectangle(source, editing.crop)).toEqual({
      x: 100,
      y: 0,
      size: 400,
    });
    expect(
      photoCropRectangle({ width: 400, height: 600 }, editing.crop),
    ).toEqual({ x: 0, y: 100, size: 400 });
  });
  it("keeps the crop inside the image at every edge and zoom", () => {
    expect(photoCropRectangle(source, { x: -1, y: 2, zoom: 2 })).toEqual({
      x: 0,
      y: 200,
      size: 200,
    });
    expect(photoCropRectangle(source, { x: 1, y: 1, zoom: 0.5 })).toEqual({
      x: 200,
      y: 0,
      size: 400,
    });
  });
  it("moves the photo with the pointer without exposing an empty edge", () => {
    expect(dragPhotoCrop(source, editing.crop, 40, 80, 160)).toEqual({
      x: 0,
      y: 0.5,
      zoom: 1,
    });
    expect(dragPhotoCrop(source, editing.crop, -1000, 0, 160)).toEqual({
      x: 1,
      y: 0.5,
      zoom: 1,
    });
  });
});
