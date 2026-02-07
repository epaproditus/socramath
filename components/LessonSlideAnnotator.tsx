"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type LessonSlideAnnotatorHandle = {
  exportPng: () => string | null;
  clear: () => void;
};

type LessonSlideAnnotatorProps = {
  imageUrl: string;
  width?: number;
  height?: number;
  onStrokeEnd?: (dataUrl: string) => void;
  enabled?: boolean;
  penColor?: string;
  penSize?: number;
  eraser?: boolean;
};

const LessonSlideAnnotator = forwardRef<LessonSlideAnnotatorHandle, LessonSlideAnnotatorProps>(
  ({
    imageUrl,
    width = 960,
    height = 540,
    onStrokeEnd,
    enabled = true,
    penColor = "#111827",
    penSize = 3,
    eraser = false,
  }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [drawing, setDrawing] = useState(false);
    const [lineWidth, setLineWidth] = useState(penSize);

    useEffect(() => {
      const img = new Image();
      img.src = imageUrl;
      imgRef.current = img;
    }, [imageUrl]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = penColor;
      ctx.lineWidth = lineWidth;
      ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    }, [lineWidth, penColor, eraser]);

    useEffect(() => {
      setLineWidth(penSize);
    }, [penSize]);

    const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { x, y } = pointerPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setDrawing(true);
    };

    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { x, y } = pointerPos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const end = () => {
      setDrawing(false);
      if (onStrokeEnd) {
        const data = exportPng();
        if (data) onStrokeEnd(data);
      }
    };

    const clear = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const exportPng = () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) return null;
      const img = imgRef.current;
      if (img && img.complete) {
        ctx.drawImage(img, 0, 0, exportCanvas.width, exportCanvas.height);
      }
      ctx.drawImage(canvas, 0, 0);
      return exportCanvas.toDataURL("image/png");
    };

    useImperativeHandle(ref, () => ({
      exportPng,
      clear,
    }));

    useEffect(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const resize = () => {
        const rect = container.getBoundingClientRect();
        const nextW = Math.max(1, Math.floor(rect.width));
        const nextH = Math.max(1, Math.floor(rect.height));
        if (canvas.width !== nextW || canvas.height !== nextH) {
          canvas.width = nextW;
          canvas.height = nextH;
        }
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      return () => observer.disconnect();
    }, []);

    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-2">
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <img
            src={imageUrl}
            alt="Slide background"
            className="absolute inset-0 h-full w-full object-contain pointer-events-none"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none"
            style={{ pointerEvents: enabled ? "auto" : "none" }}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Pen</span>
            <input
              type="range"
              min={1}
              max={8}
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
            />
          </div>
          <button
            onClick={clear}
            className="rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }
);

LessonSlideAnnotator.displayName = "LessonSlideAnnotator";

export default LessonSlideAnnotator;
