import { create } from 'zustand';
import { TestSession, MATH_TEST_SESSION, Question, StudentResponse } from './lessons';
import { fetchUserSession, addQuestionAction, updateQuestionAction, removeQuestionAction, createSessionAction } from '@/app/actions';

type AppState = {
    mode: 'student' | 'teacher';
    currentSession: TestSession;
    isLoading: boolean;
    activeQuestionId: string | null;
    tutorUnlocked: boolean;
    studentResponses: Record<string, StudentResponse>;
    sidebarOpen: boolean;
    sidebarWidth: number;
    setMode: (mode: 'student' | 'teacher') => void;
    setSession: (session: TestSession) => void;
    updateSessionTitle: (title: string) => void;
    setActiveQuestionId: (id: string | null) => void;
    setTutorUnlocked: (unlocked: boolean) => void;
    setStudentResponse: (questionId: string, response: StudentResponse) => void;
    setSidebarOpen: (open: boolean) => void;
    setSidebarWidth: (width: number) => void;
    markDoneUnlocked: boolean;
    setMarkDoneUnlocked: (unlocked: boolean) => void;
    advanceRequestId: number;
    advanceTargetIndex: number | null;
    requestAdvance: (targetIndex: number | null) => void;
    summaryRequestId: number;
    summaryQuestionId: string | null;
    requestSummary: (questionId: string | null) => void;
    nudgeRequestId: number;
    nudgeMessage: string | null;
    requestNudge: (message: string) => void;
    studentGoalsByQuestion: Record<string, string[]>;
    goalProgressByQuestion: Record<string, boolean[]>;
    setStudentGoals: (questionId: string, goals: string[]) => void;
    setGoalProgress: (questionId: string, goalIndex: number, value: boolean) => void;
    // Async Actions
    initialize: () => Promise<void>;
    addQuestion: () => Promise<void>;
    updateQuestion: (index: number, field: keyof Question, value: any) => Promise<void>;
    removeQuestion: (index: number) => Promise<void>;
    createSession: (title?: string) => Promise<void>;
};

export const useAppStore = create<AppState>((set, get) => ({
    mode: 'student',
    currentSession: MATH_TEST_SESSION, // Fallback
    isLoading: true,
    activeQuestionId: null,
    tutorUnlocked: false,
    studentResponses: {},
    sidebarOpen: false,
    sidebarWidth: 520,
    markDoneUnlocked: false,
    advanceRequestId: 0,
    advanceTargetIndex: null,
    summaryRequestId: 0,
    summaryQuestionId: null,
    nudgeRequestId: 0,
    nudgeMessage: null,
    setMode: (mode) => set({ mode }),
    setSession: (session) => set({ currentSession: session }),
    updateSessionTitle: (title) => set((state) => ({ currentSession: { ...state.currentSession, title } })),
    setActiveQuestionId: (id) => set({ activeQuestionId: id }),
    setTutorUnlocked: (unlocked) => set({ tutorUnlocked: unlocked }),
    setStudentResponse: (questionId, response) =>
        set((state) => ({
            studentResponses: { ...state.studentResponses, [questionId]: response }
        })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setSidebarWidth: (width) => set({ sidebarWidth: width }),
    setMarkDoneUnlocked: (unlocked) => set({ markDoneUnlocked: unlocked }),
    requestAdvance: (targetIndex) =>
        set((state) => ({
            advanceRequestId: state.advanceRequestId + 1,
            advanceTargetIndex: targetIndex
        })),
    requestSummary: (questionId) =>
        set((state) => ({
            summaryRequestId: state.summaryRequestId + 1,
            summaryQuestionId: questionId
        })),
    requestNudge: (message) =>
        set((state) => ({
            nudgeRequestId: state.nudgeRequestId + 1,
            nudgeMessage: message
        })),
    studentGoalsByQuestion: {},
    goalProgressByQuestion: {},
    setStudentGoals: (questionId, goals) =>
        set((state) => {
            const existingProgress = state.goalProgressByQuestion[questionId];
            const nextProgress = existingProgress && existingProgress.length === goals.length
                ? existingProgress
                : Array.from({ length: goals.length }).map((_, idx) => existingProgress?.[idx] || false);

            if (typeof window !== "undefined") {
                window.localStorage.setItem(`student-rubric-${questionId}`, JSON.stringify(goals));
                window.localStorage.setItem(`student-rubric-progress-${questionId}`, JSON.stringify(nextProgress));
            }

            return {
                studentGoalsByQuestion: { ...state.studentGoalsByQuestion, [questionId]: goals },
                goalProgressByQuestion: { ...state.goalProgressByQuestion, [questionId]: nextProgress },
            };
        }),
    setGoalProgress: (questionId, goalIndex, value) =>
        set((state) => {
            const current = state.goalProgressByQuestion[questionId] || [];
            const next = [...current];
            next[goalIndex] = value;
            if (typeof window !== "undefined") {
                window.localStorage.setItem(`student-rubric-progress-${questionId}`, JSON.stringify(next));
            }
            return {
                goalProgressByQuestion: { ...state.goalProgressByQuestion, [questionId]: next },
            };
        }),

    initialize: async () => {
        try {
            const sessionData = await fetchUserSession();
            if (sessionData) {
                // @ts-ignore - Types might mismatch slightly on optional fields, acceptable for now
                set({
                    currentSession: sessionData,
                    studentResponses: sessionData.studentResponses || {},
                    isLoading: false
                });
                if (sessionData.studentCurrentIndex && sessionData.questions?.length) {
                    const idx = Math.max(1, Math.min(sessionData.questions.length, sessionData.studentCurrentIndex));
                    set({ activeQuestionId: sessionData.questions[idx - 1]?.id || null });
                }
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
    },

    createSession: async (title?: string) => {
        try {
            const created = await createSessionAction(title);
            // @ts-ignore - Types might mismatch slightly on optional fields, acceptable for now
            set({
                currentSession: created,
                studentResponses: created.studentResponses || {},
                activeQuestionId: null,
            });
        } catch (err) {
            console.error("Failed to create session", err);
        }
    },
}));
