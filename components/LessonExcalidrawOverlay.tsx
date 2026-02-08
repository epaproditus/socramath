"use client";

import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { useEffect, useRef, useState } from "react";

type LessonExcalidrawOverlayProps = {
  imageUrl: string;
  onChange?: (dataUrl: string) => void;
  onTextChange?: (text: string) => void;
};

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false }
);

export default function LessonExcalidrawOverlay({ imageUrl, onChange, onTextChange }: LessonExcalidrawOverlayProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const debounceRef = useRef<number | null>(null);
  const textRef = useRef<string>("");
  const imageRef = useRef<HTMLImageElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [backgroundUrl, setBackgroundUrl] = useState(imageUrl);
  const fallbackBackground =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAt8B9o0F8YkAAAAASUVORK5CYII=";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setImageLoaded(false);
    setBackgroundUrl(imageUrl);
    textRef.current = "";
    if (onTextChange) onTextChange("");
    if (apiRef.current) {
      apiRef.current.updateScene({ elements: [] });
      const appState = apiRef.current.getAppState();
      apiRef.current.updateScene({ appState: { ...appState, scrollX: 0, scrollY: 0, zoom: { value: 1 } } });
    }
  }, [imageUrl]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = (e: WheelEvent) => {
      const scroller = wrapper.closest("[data-lesson-scroll]") as HTMLElement | null;
      if (!scroller) return;
      e.preventDefault();
      e.stopPropagation();
      // ensure Excalidraw doesn't hijack wheel; scroll the page container instead
      scroller.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: "auto" });
    };
    wrapper.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => wrapper.removeEventListener("wheel", handler);
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const scroller = wrapper?.closest("[data-lesson-scroll]") as HTMLElement | null;
    if (!scroller) return;
    const onScroll = () => {
      if (apiRef.current) {
        const appState = apiRef.current.getAppState();
        apiRef.current.updateScene({ appState: { ...appState, scrollX: 0, scrollY: 0 } });
      }
      apiRef.current?.refresh();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const emit = async () => {
    if (!apiRef.current || !imageRef.current) return;
    const api = apiRef.current;
    const img = imageRef.current;
    if (!img.complete) {
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }

    const elements = api.getSceneElements();
    const files = api.getFiles();
    const appState = api.getAppState();

    const { exportToCanvas } = await import("@excalidraw/excalidraw");
    const drawingCanvas = await exportToCanvas({
      elements,
      files,
      appState: {
        ...appState,
        exportBackground: false,
        viewBackgroundColor: "transparent",
        zoom: { value: 1 },
      },
      exportPadding: 0,
    });

    const out = document.createElement("canvas");
    out.width = img.naturalWidth || drawingCanvas.width || 1;
    out.height = img.naturalHeight || drawingCanvas.height || 1;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, out.width, out.height);
    if (drawingCanvas.width > 0 && drawingCanvas.height > 0) {
      const scaleX = out.width / drawingCanvas.width;
      const scaleY = out.height / drawingCanvas.height;
      ctx.drawImage(
        drawingCanvas,
        0,
        0,
        drawingCanvas.width * scaleX,
        drawingCanvas.height * scaleY
      );
    }
    const dataUrl = out.toDataURL("image/png");
    onChange?.(dataUrl);
  };

  const handleChange = () => {
    if (onTextChange && apiRef.current) {
      const elements = apiRef.current.getSceneElements();
      const text = elements
        .filter((el: any) => el?.type === "text" && typeof el?.text === "string")
        .map((el: any) => el.text.trim())
        .filter(Boolean)
        .join("\n");
      if (text !== textRef.current) {
        textRef.current = text;
        onTextChange(text);
      }
    }
    if (!onChange) return;
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      emit();
    }, 700);
  };

  const resetViewport = () => {
    if (!apiRef.current || !mountedRef.current) return;
    const appState = apiRef.current.getAppState();
    apiRef.current.updateScene({
      appState: { ...appState, scrollX: 0, scrollY: 0, zoom: { value: 1 } },
    });
  };

  useEffect(() => {
    if (!imageLoaded || !apiRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resetViewport());
    });
  }, [imageLoaded, imageUrl]);

  return (
    <div ref={wrapperRef} className="relative w-full rounded-xl border border-zinc-200 bg-zinc-50 overflow-visible">
      <img
        ref={imageRef}
        src={backgroundUrl}
        alt="Slide background"
        className="w-full h-auto block pointer-events-none"
        onLoad={() => {
          setImageLoaded(true);
          resetViewport();
        }}
        onError={() => {
          setBackgroundUrl(fallbackBackground);
          setImageLoaded(true);
        }}
      />
      {imageLoaded && (
        <div
          className="absolute left-0 top-0 excalidraw-transparent z-10"
          style={{ width: "100%", height: "100%", pointerEvents: "auto" }}
        >
          <Excalidraw
            excalidrawAPI={(api) => {
              apiRef.current = api;
              requestAnimationFrame(() => {
                requestAnimationFrame(() => resetViewport());
              });
            }}
            onChange={handleChange}
            detectScroll={false}
            handleKeyboardGlobally={false}
            viewModeEnabled={false}
            theme="light"
            initialData={{
              elements: [],
              files: {},
              appState: {
                zenModeEnabled: false,
                viewBackgroundColor: "transparent",
                gridSize: null,
                scrollX: 0,
                scrollY: 0,
                zoom: { value: 1 },
                activeTool: { type: "selection" },
              },
            }}
            UIOptions={{
              canvasActions: { saveToActiveFile: false, loadScene: false, export: false, saveAsImage: false },
            }}
          />
        </div>
      )}
    </div>
  );
}
