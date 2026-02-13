"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, PencilLine, SendHorizontal, X } from "lucide-react";
import { TLEditorSnapshot } from "tldraw";
import FlowThreeWhiteboardModal, {
  FlowThreeWhiteboardImage,
} from "@/components/FlowThreeWhiteboardModal";

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

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, draftImages]);

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
              content:
                "You are a concise tutoring copilot. The user may attach tldraw sketches summarized as shape data and labels. Use that drawing context directly when giving guidance.",
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
  }, [draftImages, input, messages, streaming]);

  return (
    <div className="mx-auto flex h-[calc(100vh-40px)] w-full max-w-6xl flex-col p-4">
      <div className="mb-3 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-zinc-900">Flow 3: tldraw Chat Kit</h1>
          <p className="text-xs text-zinc-500">
            Minimal isolated prototype. Draw sketches and chat against that context.
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
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                message.role === "user"
                  ? "ml-auto bg-zinc-900 text-white"
                  : "mr-auto bg-white text-zinc-900 border border-zinc-200"
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
                      className="max-h-36 w-full rounded-md border border-black/10 object-contain bg-white"
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
                  className="h-24 w-32 cursor-pointer object-cover bg-white"
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
            placeholder={streaming ? "Waiting for response..." : "Ask something about your sketch..."}
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
