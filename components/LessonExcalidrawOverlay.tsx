"use client";

import dynamic from "next/dynamic";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { useEffect, useRef, useState } from "react";

type LessonExcalidrawOverlayProps = {
  imageUrl: string;
  onChange?: (dataUrl: string) => void;
  onTextChange?: (text: string) => void;
};

type SceneTextElement = {
  type?: string;
  text?: string;
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
  const [attemptedPlainFallback, setAttemptedPlainFallback] = useState(false);
  const fallbackBackground =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAt8B9o0F8YkAAAAASUVORK5CYII=";

  const toPlainSlideUrl = (url: string) => {
    const [pathPart, queryPart] = url.split("?");
    const plainPath = pathPart.replace(/\/0+(\d+)\.png$/, "/$1.png");
    return queryPart ? `${plainPath}?${queryPart}` : plainPath;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setImageLoaded(false);
    setBackgroundUrl(imageUrl);
    setAttemptedPlainFallback(false);
    textRef.current = "";
    if (onTextChange) onTextChange("");
    if (apiRef.current) {
      apiRef.current.updateScene({ elements: [] });
      const appState = apiRef.current.getAppState();
      apiRef.current.updateScene({ appState: { ...appState, scrollX: 0, scrollY: 0, zoom: { value: 1 } } });
    }
  }, [imageUrl, onTextChange]);

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
    try {
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
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      const outWidth = Math.max(1, Math.round(img.naturalWidth || img.width || wrapperRect?.width || 1));
      const outHeight = Math.max(1, Math.round(img.naturalHeight || img.height || wrapperRect?.height || 1));

      const { exportToCanvas, convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const exportBounds = convertToExcalidrawElements([
        {
          type: "rectangle",
          x: 0,
          y: 0,
          width: outWidth,
          height: outHeight,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          roughness: 0,
          opacity: 0,
        },
      ]);
      const drawingCanvas = await exportToCanvas({
        elements: [...elements, ...exportBounds],
        files,
        appState: {
          ...appState,
          exportBackground: false,
          viewBackgroundColor: "transparent",
          zoom: { value: 1 },
        },
        exportPadding: 0,
        getDimensions: () => ({
          width: outWidth,
          height: outHeight,
          scale: 1,
        }),
      });

      const out = document.createElement("canvas");
      out.width = outWidth;
      out.height = outHeight;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      if (img.width > 0 && img.height > 0) {
        ctx.drawImage(img, 0, 0, out.width, out.height);
      }
      if (drawingCanvas.width > 0 && drawingCanvas.height > 0) {
        ctx.drawImage(drawingCanvas, 0, 0, out.width, out.height);
      }
      const dataUrl = out.toDataURL("image/png");
      onChange?.(dataUrl);
    } catch (err) {
      console.warn("lesson overlay export skipped", err);
    }
  };

  const handleChange = () => {
    if (onTextChange && apiRef.current) {
      const elements = apiRef.current.getSceneElements() as SceneTextElement[];
      const text = elements
        .filter((el) => el?.type === "text" && typeof el?.text === "string")
        .map((el) => (el.text || "").trim())
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
      appState: {
        ...appState,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
        zenModeEnabled: false,
      },
    });
  };

  useEffect(() => {
    if (!apiRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resetViewport());
    });
  }, [imageLoaded, imageUrl]);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full rounded-xl border border-zinc-200 bg-zinc-50 overflow-visible min-h-[480px]"
    >
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
          const plainCandidate = toPlainSlideUrl(backgroundUrl);
          if (!attemptedPlainFallback && plainCandidate !== backgroundUrl) {
            setAttemptedPlainFallback(true);
            setBackgroundUrl(plainCandidate);
            return;
          }
          setBackgroundUrl(fallbackBackground);
          setImageLoaded(true);
        }}
      />
      <div
        className="absolute left-0 top-0 excalidraw-transparent z-10"
        style={{ width: "100%", height: "100%", pointerEvents: "auto" }}
      >
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
            if (!api) return;
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
    </div>
  );
}
