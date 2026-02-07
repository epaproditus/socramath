"use client";

type GeoGebraWidgetProps = {
  materialId?: string;
  width?: number;
  height?: number;
};

export default function GeoGebraWidget({ materialId, width = 640, height = 360 }: GeoGebraWidgetProps) {
  if (!materialId) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs text-zinc-500">
        No GeoGebra material ID configured for this slide.
      </div>
    );
  }

  const src = `https://www.geogebra.org/material/iframe/id/${materialId}/width/${width}/height/${height}/border/888888/rc/false/ai/false`;

  return (
    <iframe
      src={src}
      width={width}
      height={height}
      className="w-full rounded-lg border border-zinc-200 bg-white"
      allow="fullscreen; clipboard-read; clipboard-write"
      title="GeoGebra"
    />
  );
}
