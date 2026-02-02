import { HelpCircle, ChevronDown, ChevronUp, Book } from "lucide-react";
import { useState, useEffect } from "react";
import Stack from "./Stack";
import { useAppStore } from "@/lib/store";

export const QuestionCard = ({ args }: { args?: any }) => {
    const [showVocab, setShowVocab] = useState(false);
    const { currentSession } = useAppStore();

    // If no args provided, show a placeholder or nothing
    if (!args || !args.text) return null;

    const currentQuestionIndex = (args.question_number || 1);
    const totalQuestions = (args.total_questions || 1);

    // Live Data Lookup (fallback to args if needed, but prefer store)
    const liveQuestion = currentSession.questions[currentQuestionIndex - 1];

    // Use Live Vocab or Args Vocab
    const vocabulary = liveQuestion?.vocabulary || args.vocabulary || [];
    const hasVocab = vocabulary.length > 0;
    const hasImage = !!args.image_url;

    // Prepare Cards for Stack
    const vocabCards = hasVocab ? vocabulary.map((v: any, i: number) => (
        <div key={i} className="w-full h-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center shadow-sm relative select-none overflow-hidden rounded-xl">

            {/* Split Layout: Image Top, Text Bottom */}
            {v.image_url ? (
                <>
                    <div className="h-1/2 w-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border-b border-zinc-100 dark:border-zinc-800">
                        <img src={v.image_url} alt={v.term} className="w-full h-full object-cover" />
                    </div>
                    <div className="h-1/2 w-full p-4 flex flex-col items-center justify-center bg-white dark:bg-zinc-900">
                        <h4 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-1 font-serif">
                            {v.term}
                        </h4>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-3">
                            {v.definition}
                        </p>
                    </div>
                </>
            ) : (
                <div className="p-6 flex flex-col items-center justify-center h-full">
                    <div className="w-8 h-1 bg-indigo-500 rounded-full mb-4"></div>
                    <h4 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2 font-serif">
                        {v.term}
                    </h4>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug">
                        {v.definition}
                    </p>
                </div>
            )}

            <span className="absolute bottom-2 right-3 text-[10px] font-bold text-zinc-300 uppercase tracking-widest z-10">
                {i + 1} / {vocabulary.length}
            </span>
        </div>
    )) : [];

    return (
        <div className="my-4 w-full max-w-4xl mx-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm relative">
            {/* Header */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                    <HelpCircle className="w-4 h-4" />
                    <span className="text-xs font-bold tracking-wider uppercase">Question {currentQuestionIndex} / {totalQuestions}</span>
                </div>

                {hasVocab && (
                    <button
                        onClick={() => setShowVocab(!showVocab)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${showVocab ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'}`}
                    >
                        <Book className="w-3.5 h-3.5" />
                        {showVocab ? 'Hide Vocabulary' : 'View Vocabulary'}
                    </button>
                )}
            </div>

            {/* Vocabulary Overlay / Section */}
            {hasVocab && showVocab && (
                <div className="bg-zinc-50/80 dark:bg-black/20 border-b border-zinc-200 dark:border-zinc-800 p-6 flex flex-col items-center animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-sm">
                    <div className="w-[280px] h-[320px] relative">
                        <Stack
                            randomRotation={true}
                            sensitivity={150}
                            sendToBackOnClick={true}
                            cards={vocabCards}
                        />
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-4 uppercase tracking-widest">
                        Click cards to cycle
                    </p>
                </div>
            )}

            <div className={`p-6 ${hasImage ? 'grid grid-cols-1 md:grid-cols-2 gap-8' : ''}`}>

                {/* Image Column */}
                {hasImage && (
                    <div className="flex flex-col gap-2">
                        <div className="rounded-lg overflow-hidden border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-black/20 flex items-center justify-center p-2 h-full min-h-[200px]">
                            <img
                                src={args.image_url}
                                alt="Question Diagram"
                                className="max-w-full max-h-[400px] w-auto h-auto object-contain"
                            />
                        </div>
                        <p className="text-center text-xs text-zinc-400">Figure 1.1</p>
                    </div>
                )}

                {/* Text Column */}
                <div className="flex flex-col gap-6">
                    <div className="prose dark:prose-invert prose-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                        {args.text}
                    </div>

                    <div className="mt-auto bg-red-50 dark:bg-red-900/10 rounded-lg p-4 border border-red-100 dark:border-red-900/10">
                        <h3 className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400 mb-1 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                            Student's Answer
                        </h3>
                        <p className="text-sm italic text-zinc-600 dark:text-zinc-400">
                            "{args.student_response}"
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
};
