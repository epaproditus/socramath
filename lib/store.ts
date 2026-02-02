import { create } from 'zustand';
import { TestSession, MATH_TEST_SESSION, Question } from './lessons';
import { fetchUserSession, addQuestionAction, updateQuestionAction, removeQuestionAction } from '@/app/actions';

type AppState = {
    mode: 'student' | 'teacher';
    currentSession: TestSession;
    isLoading: boolean;
    setMode: (mode: 'student' | 'teacher') => void;
    setSession: (session: TestSession) => void;
    updateSessionTitle: (title: string) => void;
    // Async Actions
    initialize: () => Promise<void>;
    addQuestion: () => Promise<void>;
    updateQuestion: (index: number, field: keyof Question, value: any) => Promise<void>;
    removeQuestion: (index: number) => Promise<void>;
};

export const useAppStore = create<AppState>((set, get) => ({
    mode: 'student',
    currentSession: MATH_TEST_SESSION, // Fallback
    isLoading: true,
    setMode: (mode) => set({ mode }),
    setSession: (session) => set({ currentSession: session }),
    updateSessionTitle: (title) => set((state) => ({ currentSession: { ...state.currentSession, title } })),

    initialize: async () => {
        try {
            const sessionData = await fetchUserSession();
            if (sessionData) {
                // @ts-ignore - Types might mismatch slightly on optional fields, acceptable for now
                set({ currentSession: sessionData, isLoading: false });
            } else {
                console.log("No user session found (not logged in), keeping mock data");
                set({ isLoading: false });
            }
        } catch (err) {
            console.error("Failed to initialize session", err);
            set({ isLoading: false });
        }
    },

    addQuestion: async () => {
        const { currentSession } = get();
        // Optimistic
        const tempId = `temp-${Date.now()}`;
        const newQ: Question = {
            id: tempId,
            text: "",
            student_response: "",
            rubric: [""],
            vocabulary: []
        };

        set((state) => ({
            currentSession: {
                ...state.currentSession,
                questions: [...state.currentSession.questions, newQ]
            }
        }));

        try {
            // Server Action
            const savedQ = await addQuestionAction(currentSession.id, currentSession.questions.length);

            // Replace Temp
            set((state) => ({
                currentSession: {
                    ...state.currentSession,
                    questions: state.currentSession.questions.map(q => q.id === tempId ? savedQ : q)
                }
            }));
        } catch (err) {
            console.error("Failed to save question", err);
        }
    },

    updateQuestion: async (index, field, value) => {
        // Optimistic
        set((state) => {
            const newQuestions = [...state.currentSession.questions];
            newQuestions[index] = { ...newQuestions[index], [field]: value };
            return { currentSession: { ...state.currentSession, questions: newQuestions } };
        });

        const { currentSession } = get();
        const question = currentSession.questions[index];

        if (question.id && !question.id.startsWith('temp')) {
            await updateQuestionAction(question.id, field as string, value);
        }
    },

    removeQuestion: async (index) => {
        const { currentSession } = get();
        const questionToRemove = currentSession.questions[index];

        // Optimistic
        set((state) => ({
            currentSession: {
                ...state.currentSession,
                questions: state.currentSession.questions.filter((_, i) => i !== index)
            }
        }));

        if (questionToRemove.id && !questionToRemove.id.startsWith('temp')) {
            await removeQuestionAction(questionToRemove.id);
        }
    }
}));
