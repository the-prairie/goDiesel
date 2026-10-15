// Keep Cesium's live credit nodes intact so the sources continue to follow the
// visible tiles. Only their presentation changes in constrained map viewports.
export function installAtlasAttribution(container: Element) {
  if (!(container instanceof HTMLElement)) return () => {};
  const sources = container.querySelector<HTMLElement>(".cesium-credit-textContainer");
  if (!sources) return () => {};
  container.classList.add("atlas-attribution");
  sources.id = "atlas-data-sources";
  sources.setAttribute("role", "region");
  sources.setAttribute("aria-label", "Map data sources");

  const brand = document.createElement("span");
  brand.className = "atlas-attribution-brand";
  brand.textContent = "Google Maps";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "atlas-attribution-toggle";
  toggle.textContent = "Data sources";
  toggle.setAttribute("aria-controls", sources.id);
  toggle.setAttribute("aria-expanded", "false");
  container.append(brand, toggle);

  const setOpen = (open: boolean) => {
    container.setAttribute("data-sources-open", String(open));
    toggle.setAttribute("aria-expanded", String(open));
  };
  const onClick = () => setOpen(toggle.getAttribute("aria-expanded") !== "true");
  const onOutside = (event: PointerEvent) => {
    if (!container.contains(event.target as Node)) setOpen(false);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      toggle.focus();
    }
  };
  const resize = new ResizeObserver(([entry]) => {
    // The long, viewport-dependent source list otherwise consumes several
    // map rows at these widths. Wide maps retain the full inline attribution.
    container.setAttribute("data-compact", String(entry.contentRect.width < 1000));
    setOpen(false);
  });
  resize.observe(container);
  const providerChange = new MutationObserver(() => setOpen(false));
  providerChange.observe(container, { attributes: true, attributeFilter: ["data-google"] });
  toggle.addEventListener("click", onClick);
  container.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside);
  return () => {
    resize.disconnect();
    providerChange.disconnect();
    toggle.removeEventListener("click", onClick);
    container.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutside);
    brand.remove();
    toggle.remove();
  };
}
