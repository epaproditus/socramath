"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, PencilLine, SendHorizontal, X } from "lucide-react";
import { TLEditorSnapshot } from "tldraw";
import FlowThreeWhiteboardModal, {
  FlowThreeWhiteboardImage,
} from "@/components/FlowThreeWhiteboardModal";
import LessonBlockPanel from "@/components/LessonBlockPanel";
import { LessonBlock } from "@/lib/lesson-blocks";
import {
  computeLessonSlideCompletion,
  LessonResponseJson,
  LessonSlideCompletion,
  normalizeLessonResponseJson,
} from "@/lib/lesson-response";

type FlowThreeRole = "user" | "assistant";

type FlowThreeMessage = {
  id: string;
  role: FlowThreeRole;
  text: string;
  images: FlowThreeWhiteboardImage[];
};

type WhiteboardState = {
  imageId?: string;
  imageName?: string;
  snapshot?: TLEditorSnapshot;
} | null;

type FlowThreeLessonState = {
  lesson: {
    id: string;
    title: string;
    content?: string;
    pageCount?: number;
  };
  session: {
    id: string;
    mode: "instructor" | "student";
    currentSlideIndex: number;
    isFrozen?: boolean;
  };
  currentSlideIndex: number;
  currentSlideId: string | null;
  slidePrompt?: string;
  slideText?: string;
  slideResponseType?: string;
  slideBlocks?: LessonBlock[];
  slideResponseJson?: LessonResponseJson | null;
  slideCompletion?: LessonSlideCompletion | null;
  slideWork?: {
    responseText?: string;
    drawingPath?: string;
    drawingText?: string;
  } | null;
};

const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const readShapeRecords = (snapshot: TLEditorSnapshot) => {
  const records: Record<string, unknown>[] = [];
  const root =
    snapshot && typeof snapshot === "object"
      ? (snapshot as unknown as Record<string, unknown>)
      : null;
  if (!root) return records;

  const store = root.store;
  if (store && typeof store === "object") {
    for (const value of Object.values(store as Record<string, unknown>)) {
      if (
        value &&
        typeof value === "object" &&
        "typeName" in (value as Record<string, unknown>) &&
        (value as { typeName?: unknown }).typeName === "shape"
      ) {
        records.push(value as Record<string, unknown>);
      }
    }
  }

  if (!records.length) {
    const documentValue = root.document;
    if (documentValue && typeof documentValue === "object") {
      const pages = (documentValue as Record<string, unknown>).pages;
      if (pages && typeof pages === "object") {
        for (const page of Object.values(pages as Record<string, unknown>)) {
          if (!page || typeof page !== "object") continue;
          const shapes = (page as Record<string, unknown>).shapes;
          if (!shapes || typeof shapes !== "object") continue;
          for (const shape of Object.values(shapes as Record<string, unknown>)) {
            if (shape && typeof shape === "object") {
              records.push(shape as Record<string, unknown>);
            }
          }
        }
      }
    }
  }

  return records;
};

const summarizeSnapshot = (snapshot: TLEditorSnapshot) => {
  const shapes = readShapeRecords(snapshot);
  const byType: Record<string, number> = {};
  const labels: string[] = [];

  for (const shape of shapes) {
    const shapeType = typeof shape.type === "string" ? shape.type : "shape";
    byType[shapeType] = (byType[shapeType] || 0) + 1;

    const props =
      shape.props && typeof shape.props === "object"
        ? (shape.props as Record<string, unknown>)
        : null;
    if (!props) continue;

    const rawText =
      typeof props.text === "string"
        ? props.text
        : typeof props.plainText === "string"
        ? props.plainText
        : "";
    const text = rawText.trim();
    if (text) labels.push(text);
  }

  return {
    shapeCount: shapes.length,
    byType,
    textLabels: labels.slice(0, 8),
  };
};

const buildUserMessageContent = (message: FlowThreeMessage) => {
  const sections: string[] = [];
  const text = message.text.trim();
  if (text) {
    sections.push(`User message:\n${text}`);
  }

  if (message.images.length) {
    const sketchSections = message.images.map((image, idx) => {
      const summary = summarizeSnapshot(image.snapshot);
      return [
        `Sketch ${idx + 1}: ${image.name}`,
        `Size: ${image.width}x${image.height}`,
        `Summary: ${JSON.stringify(summary)}`,
      ].join("\n");
    });
    sections.push(`Attached tldraw sketches:\n${sketchSections.join("\n\n")}`);
  }

  return sections.join("\n\n").trim() || "(empty user message)";
};

const parseSseStream = async (
  response: Response,
  onTextDelta: (delta: string) => void
) => {
  if (!response.body) throw new Error("Missing response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneSignal = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done || doneSignal) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") {
        doneSignal = true;
        break;
      }
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      if (!parsed) continue;
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const delta =
        first &&
        typeof first === "object" &&
        first.delta &&
        typeof first.delta === "object"
          ? (first.delta as Record<string, unknown>)
          : null;
      const textDelta =
        delta && typeof delta.content === "string" ? delta.content : "";
      if (textDelta) {
        onTextDelta(textDelta);
      }
    }
  }
};

export default function FlowThreeChat() {
  const [messages, setMessages] = useState<FlowThreeMessage[]>([]);
  const [input, setInput] = useState("");
  const [draftImages, setDraftImages] = useState<FlowThreeWhiteboardImage[]>([]);
  const [whiteboardState, setWhiteboardState] = useState<WhiteboardState>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lessonState, setLessonState] = useState<FlowThreeLessonState | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [blockResponseJson, setBlockResponseJson] = useState<LessonResponseJson | null>(null);
  const [blockSaving, setBlockSaving] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadLessonState = useCallback(async () => {
    setLessonLoading(true);
    try {
      const response = await fetch("/api/lesson-state");
      if (!response.ok) {
        setLessonState(null);
        return;
      }
      const json = (await response.json()) as FlowThreeLessonState;
      setLessonState(json);
      setBlockResponseJson(normalizeLessonResponseJson(json.slideResponseJson || {}));
    } catch {
      setLessonState(null);
    } finally {
      setLessonLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLessonState();
  }, [loadLessonState]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadLessonState();
    }, 4000);
    return () => clearInterval(timer);
  }, [loadLessonState]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, draftImages]);

  useEffect(() => {
    if (!lessonState?.slideResponseJson) return;
    setBlockResponseJson(normalizeLessonResponseJson(lessonState.slideResponseJson));
  }, [lessonState?.currentSlideId, lessonState?.slideResponseJson]);

  const drawingReady =
    draftImages.length > 0 ||
    !!lessonState?.slideWork?.drawingPath ||
    !!lessonState?.slideWork?.drawingText;

  const slideCompletion = useMemo(() => {
    if (!lessonState) return null;
    return computeLessonSlideCompletion({
      blocks: lessonState.slideBlocks || [],
      responseJson: blockResponseJson,
      drawingPath: lessonState.slideWork?.drawingPath || "",
      drawingText: drawingReady ? "sketch submitted in chat" : lessonState.slideWork?.drawingText || "",
    });
  }, [blockResponseJson, drawingReady, lessonState]);

  const canSend = useMemo(
    () => !streaming && (!!input.trim() || draftImages.length > 0),
    [draftImages.length, input, streaming]
  );

  const openNewWhiteboard = () => {
    if (streaming) return;
    setWhiteboardState({});
  };

  const openEditWhiteboard = (image: FlowThreeWhiteboardImage) => {
    if (streaming) return;
    setWhiteboardState({
      imageId: image.id,
      imageName: image.name,
      snapshot: image.snapshot,
    });
  };

  const handleWhiteboardAccept = (image: FlowThreeWhiteboardImage) => {
    setDraftImages((prev) => {
      if (whiteboardState?.imageId) {
        return prev.map((item) => (item.id === whiteboardState.imageId ? image : item));
      }
      return [...prev, image];
    });
    setWhiteboardState(null);
  };

  const submitBlocks = useCallback(async () => {
    if (!lessonState?.session?.id || !lessonState.currentSlideId) return;
    setBlockSaving(true);
    setBlockError(null);
    try {
      const response = await fetch("/api/lesson-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: lessonState.session.id,
          slideId: lessonState.currentSlideId,
          response: "",
          responseType: lessonState.slideResponseType || "text",
          responseJson: blockResponseJson,
          drawingText: drawingReady ? "Sketch submitted in Flow 3 chat." : "",
        }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to save block responses");
      }
      await loadLessonState();
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message ? err.message : "Failed to save block responses";
      setBlockError(message);
    } finally {
      setBlockSaving(false);
    }
  }, [
    blockResponseJson,
    drawingReady,
    lessonState?.currentSlideId,
    lessonState?.session?.id,
    lessonState?.slideResponseType,
    loadLessonState,
  ]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && draftImages.length === 0) || streaming) return;

    const userMessage: FlowThreeMessage = {
      id: createId(),
      role: "user",
      text,
      images: draftImages,
    };
    const assistantId = createId();
    const assistantStub: FlowThreeMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      images: [],
    };

    const nextMessages = [...messages, userMessage];
    setMessages((prev) => [...prev, userMessage, assistantStub]);
    setInput("");
    setDraftImages([]);
    setStreaming(true);
    setError(null);

    try {
      const apiMessages = nextMessages.map((message) =>
        message.role === "assistant"
          ? { role: "assistant", content: message.text }
          : { role: "user", content: buildUserMessageContent(message) }
      );

      const response = await fetch("/api/manual-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          messages: [
            {
              role: "system",
              content: `You are a concise Socratic tutor for a student lesson.
Lesson title: ${lessonState?.lesson.title || "Lesson"}
Current slide index: ${lessonState?.currentSlideIndex || "unknown"}
Current slide prompt: ${lessonState?.slidePrompt || "None"}
Current visible blocks (teacher-controlled): ${JSON.stringify(lessonState?.slideBlocks || [])}
Current block responses: ${JSON.stringify(blockResponseJson || { version: 1, blocks: {} })}
Student may attach tldraw sketches summarized as shapes and labels. Use that context directly.`,
            },
            ...apiMessages,
          ],
        }),
      });

      if (!response.ok) {
        throw new Error((await response.text()) || "Chat request failed");
      }

      await parseSseStream(response, (delta) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, text: `${message.text}${delta}` }
              : message
          )
        );
      });

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId && !message.text.trim()
            ? { ...message, text: "I’m here. Send another message to continue." }
            : message
        )
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message ? err.message : "Flow 3 chat failed";
      setError(message);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                text: item.text || `Error: ${message}`,
              }
            : item
        )
      );
    } finally {
      setStreaming(false);
    }
  }, [blockResponseJson, draftImages, input, lessonState, messages, streaming]);

  return (
    <div className="mx-auto flex h-[calc(100vh-40px)] w-full max-w-[1400px] flex-col p-4">
      <div className="mb-3 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-zinc-900">Student Chat + Blocks</h1>
          <p className="text-xs text-zinc-500">
            Chat with tldraw sketches using teacher-predetermined lesson blocks.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
          onClick={() => {
            setMessages([]);
            setDraftImages([]);
            setError(null);
          }}
          disabled={streaming}
        >
          <Eraser className="h-4 w-4" />
          Clear
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col">
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4"
          >
            {messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500">
                Start by sketching with tldraw or typing a message.
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[86%] rounded-xl px-3 py-2 text-sm ${
                    message.role === "user"
                      ? "ml-auto bg-zinc-900 text-white"
                      : "mr-auto border border-zinc-200 bg-white text-zinc-900"
                  }`}
                >
                  {message.text ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{message.text}</div>
                  ) : (
                    <div className="opacity-70">...</div>
                  )}
                  {message.images.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {message.images.map((image) => (
                        <img
                          key={image.id}
                          src={image.url}
                          alt={image.name}
                          className="max-h-36 w-full rounded-md border border-black/10 bg-white object-contain"
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {error ? (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
            {draftImages.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {draftImages.map((image) => (
                  <div
                    key={image.id}
                    className="group relative overflow-hidden rounded-lg border border-zinc-200"
                  >
                    <img
                      src={image.url}
                      alt={image.name}
                      className="h-24 w-32 cursor-pointer bg-white object-cover"
                      onClick={() => openEditWhiteboard(image)}
                    />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                      onClick={() => {
                        setDraftImages((prev) => prev.filter((item) => item.id !== image.id));
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={streaming ? "Waiting for response..." : "Ask something about this slide..."}
                disabled={streaming}
                className="min-h-[48px] flex-1 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:bg-zinc-100"
              />
              <button
                type="button"
                onClick={openNewWhiteboard}
                disabled={streaming}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-200 px-3 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
                title="Draw sketch"
              >
                <PencilLine className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSend();
                }}
                disabled={!canSend}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-3 text-white disabled:opacity-40"
                title="Send"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3">
          <div className="mb-2 text-xs text-zinc-500">
            {lessonState?.lesson?.title
              ? `${lessonState.lesson.title} • Slide ${lessonState.currentSlideIndex}`
              : lessonLoading
              ? "Loading lesson..."
              : "No active lesson session"}
          </div>
          {lessonState?.slidePrompt ? (
            <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
              {lessonState.slidePrompt}
            </div>
          ) : null}
          <LessonBlockPanel
            blocks={lessonState?.slideBlocks || []}
            responseJson={blockResponseJson}
            completion={slideCompletion || lessonState?.slideCompletion || null}
            drawingReady={drawingReady}
            disabled={!!lessonState?.session?.isFrozen || blockSaving}
            saving={blockSaving}
            onChange={(next) => setBlockResponseJson(next)}
            onSubmit={submitBlocks}
          />
          {blockError ? (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {blockError}
            </div>
          ) : null}
        </aside>
      </div>

      {whiteboardState && (
        <FlowThreeWhiteboardModal
          imageId={whiteboardState.imageId}
          imageName={whiteboardState.imageName}
          initialSnapshot={whiteboardState.snapshot}
          onCancel={() => setWhiteboardState(null)}
          onAccept={handleWhiteboardAccept}
        />
      )}
    </div>
  );
}
