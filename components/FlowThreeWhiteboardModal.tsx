import { useCallback, useMemo, useState } from "react";
import {
  createShapeId,
  Editor,
  TLComponents,
  Tldraw,
  TldrawOptions,
  TLEditorSnapshot,
  TldrawUiButton,
  TldrawUiRow,
} from "tldraw";

export type FlowThreeWhiteboardImage = {
  id: string;
  name: string;
  url: string;
  snapshot: TLEditorSnapshot;
  type: string;
  width: number;
  height: number;
};

type FlowThreeWhiteboardModalProps = {
  initialSnapshot?: TLEditorSnapshot;
  imageId?: string;
  imageName?: string;
  onCancel: () => void;
  onAccept: (image: FlowThreeWhiteboardImage) => void;
};

const options: Partial<TldrawOptions> = {
  maxPages: 1,
  actionShortcutsLocation: "menu",
  maxFontsToLoadBeforeRender: 0,
};

export default function FlowThreeWhiteboardModal({
  initialSnapshot,
  imageId,
  imageName,
  onCancel,
  onAccept,
}: FlowThreeWhiteboardModalProps) {
  const [editor, setEditor] = useState<Editor | null>(null);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const shapes = editor.getCurrentPageShapes();
    if (shapes.length === 0) {
      onCancel();
      return;
    }

    const image = await editor.toImageDataUrl(shapes, { format: "png" });
    const snapshot = editor.getSnapshot();
    onAccept({
      id: imageId || createShapeId(),
      name: imageName || "tldraw-sketch.png",
      snapshot,
      type: "image/png",
      ...image,
    });
  }, [editor, imageId, imageName, onAccept, onCancel]);

  const components = useMemo(
    (): TLComponents => ({
      SharePanel: () => {
        return (
          <TldrawUiRow className="!gap-2 !rounded-lg !bg-white/90 !p-1 shadow">
            <TldrawUiButton type="normal" onClick={onCancel}>
              Cancel
            </TldrawUiButton>
            <TldrawUiButton type="primary" onClick={handleSave}>
              {imageId ? "Save" : "Add"}
            </TldrawUiButton>
          </TldrawUiRow>
        );
      },
    }),
    [handleSave, imageId, onCancel]
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          void handleSave();
        }
      }}
    >
      <div className="h-full w-full overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <Tldraw
          forceMobile
          options={options}
          components={components}
          snapshot={initialSnapshot}
          onMount={(mounted) => {
            setEditor(mounted);
            mounted.user.updateUserPreferences({ colorScheme: "light" });
            mounted.selectNone();
            const shapeIds = Array.from(mounted.getCurrentPageShapeIds());
            if (shapeIds.length > 0) {
              mounted.setSelectedShapes(shapeIds);
              mounted.zoomToSelection();
              mounted.selectNone();
            } else {
              mounted.zoomToFit();
            }
          }}
        />
      </div>
    </div>
  );
}
