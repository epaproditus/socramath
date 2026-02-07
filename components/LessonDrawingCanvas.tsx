"use client";

import { useEffect, useRef, useState } from "react";

type LessonDrawingCanvasProps = {
  onChange?: (dataUrl: string) => void;
};

export default function LessonDrawingCanvas({ onChange }: LessonDrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [lineWidth, setLineWidth] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = lineWidth;
  }, [lineWidth]);

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
    const canvas = canvasRef.current;
    if (canvas && onChange) {
      onChange(canvas.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (onChange) onChange(canvas.toDataURL("image/png"));
  };

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-2">
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        className="h-[220px] w-full rounded-md border border-zinc-200 bg-white touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
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
