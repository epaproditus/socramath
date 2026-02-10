"use client";

import dynamic from "next/dynamic";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Box } from "tldraw";
import type { Editor, TLEditorSnapshot, TLShape } from "tldraw";

type LessonExcalidrawOverlayProps = {
  imageUrl: string;
  onChange?: (dataUrl: string) => void;
  onTextChange?: (text: string) => void;
  onOcrText?: (text: string) => void;
  readOnly?: boolean;
  borderClassName?: string;
  sceneData?: {
    elements?: unknown[];
    files?: Record<string, unknown>;
    appState?: Record<string, unknown>;
    snapshot?: Partial<TLEditorSnapshot>;
  };
  onSceneChange?: (sceneData: {
    elements: unknown[];
    files: Record<string, unknown>;
    appState: Record<string, unknown>;
    snapshot: Partial<TLEditorSnapshot>;
  }) => void;
};

const Tldraw = dynamic(() => import("tldraw").then((mod) => mod.Tldraw), { ssr: false });

const uiComponents = {
  MainMenu: null,
  ContextMenu: null,
  ActionsMenu: null,
  HelpMenu: null,
  ZoomMenu: null,
  StylePanel: null,
  PageMenu: null,
  NavigationPanel: null,
  Minimap: null,
  QuickActions: null,
  HelperButtons: null,
  DebugMenu: null,
  DebugPanel: null,
  MenuPanel: null,
  SharePanel: null,
} as const;

const fallbackBackground =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAt8B9o0F8YkAAAAASUVORK5CYII=";

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}

function extractRichText(value: unknown): string[] {
  const lines: string[] = [];

  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const text = record.text;
    if (typeof text === "string" && text.trim()) {
      lines.push(text.trim());
    }
    if (record.content) {
      walk(record.content);
    }
  };

  walk(value);
  return lines;
}

function extractTextFromShapes(shapes: TLShape[]) {
  const lines: string[] = [];
  for (const shape of shapes) {
    const props = (shape as { props?: Record<string, unknown> }).props;
    if (!props) continue;

    const directText = props.text;
    if (typeof directText === "string" && directText.trim()) {
      lines.push(directText.trim());
    }

    if (props.richText) {
      lines.push(...extractRichText(props.richText));
    }
  }

  return Array.from(new Set(lines)).join("\n");
}

const LessonExcalidrawOverlay = forwardRef(function LessonExcalidrawOverlay(
  {
    imageUrl,
    onChange,
    onTextChange,
    onOcrText,
    readOnly,
    borderClassName,
    sceneData,
    onSceneChange,
  }: LessonExcalidrawOverlayProps,
  ref
) {
  const editorRef = useRef<Editor | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  const hydratingRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const textRef = useRef("");
  const lastSceneSignatureRef = useRef("");
  const onChangeRef = useRef(onChange);
  const onTextChangeRef = useRef(onTextChange);
  const onOcrTextRef = useRef(onOcrText);
  const onSceneChangeRef = useRef(onSceneChange);
  const [backgroundUrl, setBackgroundUrl] = useState(imageUrl);
  const [attemptedPlainFallback, setAttemptedPlainFallback] = useState(false);
  const ocrRunningRef = useRef(false);

  const editorKey = useMemo(() => imageUrl, [imageUrl]);

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
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    onOcrTextRef.current = onOcrText;
  }, [onOcrText]);

  useEffect(() => {
    onSceneChangeRef.current = onSceneChange;
  }, [onSceneChange]);

  useEffect(() => {
    setBackgroundUrl(imageUrl);
    setAttemptedPlainFallback(false);
    textRef.current = "";
    lastSceneSignatureRef.current = "";
  }, [imageUrl]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = (e: WheelEvent) => {
      const scroller = wrapper.closest("[data-lesson-scroll]") as HTMLElement | null;
      if (!scroller) return;
      e.preventDefault();
      e.stopPropagation();
      scroller.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: "auto" });
    };
    wrapper.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => wrapper.removeEventListener("wheel", handler);
  }, []);

  const emitComposite = async () => {
    if (!editorRef.current) return;

    const img = imageRef.current;
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const width = Math.max(1, Math.round(img?.naturalWidth || img?.width || wrapperRect?.width || 1280));
    const height = Math.max(1, Math.round(img?.naturalHeight || img?.height || wrapperRect?.height || 720));

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    if (img && img.width > 0 && img.height > 0) {
      ctx.drawImage(img, 0, 0, width, height);
    }

    const shapeIds = Array.from(editorRef.current.getCurrentPageShapeIds());
    if (shapeIds.length > 0) {
      const { url } = await editorRef.current.toImageDataUrl(shapeIds, {
        format: "png",
        background: false,
        padding: 0,
        pixelRatio: 1,
        bounds: new Box(0, 0, width, height),
      });
      const drawing = await loadImage(url);
      ctx.drawImage(drawing, 0, 0, width, height);
    }

    onChangeRef.current?.(out.toDataURL("image/png"));
  };

  const exportDrawingDataUrl = async () => {
    if (!editorRef.current) return null;
    const shapeIds = Array.from(editorRef.current.getCurrentPageShapeIds());
    if (shapeIds.length === 0) return null;
    const wrapperRect = wrapperRef.current?.getBoundingClientRect();
    const width = Math.max(1, Math.round(wrapperRect?.width || 1280));
    const height = Math.max(1, Math.round(wrapperRect?.height || 720));
    const { url } = await editorRef.current.toImageDataUrl(shapeIds, {
      format: "png",
      background: true,
      padding: 0,
      pixelRatio: 1,
      bounds: new Box(0, 0, width, height),
    });
    return url;
  };

  const runOcr = async () => {
    if (ocrRunningRef.current) return;
    ocrRunningRef.current = true;
    try {
      const dataUrl = await exportDrawingDataUrl();
      if (!dataUrl) {
        onOcrTextRef.current?.("");
        return;
      }
      const tesseract = await import("tesseract.js");
      const worker = await tesseract.createWorker("eng");
      try {
        const { data } = await worker.recognize(dataUrl);
        const text = (data?.text || "").trim();
        onOcrTextRef.current?.(text);
      } finally {
        await worker.terminate();
      }
    } finally {
      ocrRunningRef.current = false;
    }
  };

  useImperativeHandle(ref, () => ({ runOcr }), []);

  const emitScene = () => {
    if (!editorRef.current || !onSceneChangeRef.current) return;
    const snapshot = editorRef.current.getSnapshot();
    const payload = {
      elements: [],
      files: {},
      appState: {},
      snapshot,
    };
    const signature = JSON.stringify(payload);
    if (signature === lastSceneSignatureRef.current) return;
    lastSceneSignatureRef.current = signature;
    onSceneChangeRef.current(payload);
  };

  const handleMutation = () => {
    if (!editorRef.current || hydratingRef.current) return;

    const text = extractTextFromShapes(editorRef.current.getCurrentPageShapes());
    if (text !== textRef.current) {
      textRef.current = text;
      onTextChangeRef.current?.(text);
    }

    emitScene();

    if (!onChangeRef.current) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void emitComposite();
    }, 500);
  };

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full rounded-xl border-2 ${borderClassName || "border-zinc-200"} bg-zinc-50 overflow-visible min-h-[480px]`}
    >
      <img
        ref={imageRef}
        src={backgroundUrl}
        alt="Slide background"
        className="w-full h-auto block pointer-events-none"
        onError={() => {
          const plainCandidate = toPlainSlideUrl(backgroundUrl);
          if (!attemptedPlainFallback && plainCandidate !== backgroundUrl) {
            setAttemptedPlainFallback(true);
            setBackgroundUrl(plainCandidate);
            return;
          }
          setBackgroundUrl(fallbackBackground);
        }}
      />

      <div
        className={`absolute left-0 top-0 z-10 h-full w-full tldraw-transparent ${
          readOnly ? "pointer-events-none" : ""
        }`}
      >
        <Tldraw
          key={editorKey}
          autoFocus={false}
          inferDarkMode={false}
          hideUi={false}
          cameraOptions={{ isLocked: true }}
          components={uiComponents}
          onMount={(editor) => {
            editorRef.current = editor;

            hydratingRef.current = true;
            try {
              const snapshot = sceneData?.snapshot;
              if (snapshot) {
                editor.loadSnapshot(snapshot);
              }
              editor.setCurrentTool("select");
            } finally {
              requestAnimationFrame(() => {
                hydratingRef.current = false;
              });
            }

            const removeStoreListener = editor.store.listen(
              () => {
                handleMutation();
              },
              { source: "user", scope: "document" }
            );

            requestAnimationFrame(() => {
              if (!mountedRef.current) return;
              handleMutation();
            });

            return () => {
              removeStoreListener();
            };
          }}
        />
      </div>
    </div>
  );
});

export default LessonExcalidrawOverlay;
