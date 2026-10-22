import {
  getReplayMarker,
  subscribeReplayMarker,
} from "@/data/replay-marker-preference";

export function attachRoutePositionMarker(marker: HTMLElement) {
  let disposed = false;
  let content: HTMLElement | undefined;
  const dot = () => {
    const light = document.createElement("span");
    light.style.cssText =
      "display:block;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fffef8 30%,#f3e2af 100%);box-shadow:0 1px 3px 1px rgba(15,23,26,.65),0 0 9px 3px rgba(255,241,196,.38);pointer-events:none";
    return light;
  };
  const replace = (element: HTMLElement, kind: "dot" | "photo") => {
    content?.remove();
    content = element;
    marker.append(element);
    marker.dataset.markerKind = kind;
  };
  const update = () => {
    const preference = getReplayMarker();
    if (preference.kind === "dot") {
      replace(dot(), "dot");
      return;
    }
    const photo = document.createElement("img");
    photo.alt = "Your route position";
    photo.style.cssText =
      "display:block;box-sizing:border-box;width:30px;height:30px;object-fit:cover;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px #0009;pointer-events:none";
    photo.addEventListener(
      "error",
      () => {
        if (!disposed && content === photo) replace(dot(), "dot");
      },
      { once: true },
    );
    photo.src = preference.photo;
    replace(photo, "photo");
  };
  update();
  const unsubscribe = subscribeReplayMarker(update);
  return () => {
    disposed = true;
    unsubscribe();
    content?.remove();
  };
}
