export type Question = {
    id: string;
    text: string;           // The problem context / question
    image_url?: string;     // Optional image
    student_response: string; // The student's incorrect answer
    rubric: string[];       // Criteria for this specific question
    vocabulary?: { term: string; definition: string; image_url?: string }[]; // Optional vocab deck
};

export type TestSession = {
    id: string;
    title: string;
    studentProfile?: {
        name: string | null;
        classPeriod: string | null;
    } | null;
    questions: Question[];
    studentResponses?: Record<string, StudentResponse>;
};

export type StudentResponse = {
    id: string;
    questionId: string;
    initialReasoning?: string | null;
    originalAnswer?: string | null;
    difficulty?: number | null;
    confidence?: number | null;
    revisedAnswer?: string | null;
    summary?: string | null;
};

export const MATH_TEST_SESSION: TestSession = {
    id: "ap-calc-ab-unit-1",
    title: "AP Calculus AB - Unit 4 Test Corrections",
    questions: [
        {
            id: "q1",
            text: "A farmer has 2400 feet of fencing and wants to fence off a rectangular field that borders a straight river. No fence is needed along the river. What are the dimensions of the field that has the largest area?",
            student_response: "I found the derivative and set it to zero, getting x = 12. So the dimensions are 12x12.",
            rubric: [
                "Realizes equation is 2x + y = 2400 (not 2x + 2y)",
                "Identifies Area function A(x) = x(2400-2x)",
                "Finds correct critical point x=600"
            ]
        },
        {
            id: "q2",
            text: "Find the limit as x approaches 0 of (sin x)/x.",
            student_response: "It's 0/0 so it's undefined.",
            rubric: [
                "Recognizes indeterminate form 0/0",
                "Applies L'Hopital's Rule OR uses known identity",
                "Corrects answers to 1"
            ]
        }
    ]
};
