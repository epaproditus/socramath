import { Lightbulb } from "lucide-react";
import Stack from "./Stack";

export const HintStack = ({ args }: { args?: any }) => {
    // args should contain a list of hints (strings) or images
    if (!args || !args.items || !Array.isArray(args.items)) return null;

    const cards = args.items.map((item: { type: 'text' | 'image', content: string }, i: number) => {
        if (item.type === 'image') {
            return (
                <div className="w-full h-full bg-white dark:bg-zinc-800 border-4 border-white dark:border-zinc-700 shadow-xl overflow-hidden flex items-center justify-center">
                    <img src={item.content} alt={`Hint ${i}`} className="w-full h-full object-cover" />
                </div>
            );
        }
        return (
            <div className="w-full h-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-6 flex items-center justify-center text-center shadow-xl">
                <p className="text-lg font-medium text-zinc-800 dark:text-zinc-200">
                    {item.content}
                </p>
                <span className="absolute bottom-4 right-4 text-xs font-bold text-zinc-300">#{i + 1}</span>
            </div>
        );
    });

    return (
        <div className="my-6 mx-auto w-full max-w-[300px] h-[300px]">
            <div className="flex items-center justify-center gap-2 mb-4 text-amber-500">
                <Lightbulb className="w-5 h-5" />
                <span className="text-sm font-bold uppercase tracking-widest">Helpful Hints</span>
            </div>

            <div className="w-[250px] h-[250px] mx-auto">
                <Stack
                    randomRotation={true}
                    sensitivity={180}
                    sendToBackOnClick={true}
                    cards={cards}
                />
            </div>
            <p className="text-center text-xs text-zinc-400 mt-4 italic">Click or drag cards to cycle</p>
        </div>
    );
};
