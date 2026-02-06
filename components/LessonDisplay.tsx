"use client";

export const LessonDisplay = ({ args }: { args?: any }) => {
  const title = typeof args?.title === "string" ? args.title : "Lesson";
  const content = typeof args?.content === "string" ? args.content : "";

  if (!content) return null;

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
        Lesson Context
      </div>
      <div className="mt-1 text-base font-semibold">{title}</div>
      <div className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-relaxed">
        {content}
      </div>
    </div>
  );
};
