import { BookOpen } from "lucide-react";

export const LessonCard = ({ args }: { args?: any }) => {
    // If no args provided, show a placeholder or nothing
    if (!args || !args.title) return null;

    return (
        <div className="my-4 max-w-2xl mx-auto space-y-6 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <BookOpen className="w-5 h-5" />
                <span className="text-sm font-semibold tracking-wide uppercase">Lesson Content</span>
            </div>

            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {args.title}
            </h1>

            <div className="prose dark:prose-invert text-sm text-zinc-600 dark:text-zinc-300">
                {/* Simple whitespace handling for now. Markdown rendering would be better later. */}
                <div className="whitespace-pre-wrap">{args.content}</div>
            </div>
        </div>
    );
};
