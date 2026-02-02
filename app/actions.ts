"use server";

import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";
import { MATH_TEST_SESSION } from "@/lib/lessons";

const prisma = new PrismaClient();

export async function fetchUserSession() {
    const session = await auth();
    if (!session?.user?.id) return null;

    const userId = session.user.id;

    // 1. Try to find existing session
    let dbSession = await prisma.testSession.findFirst({
        where: { userId },
        include: { questions: { orderBy: { orderIndex: 'asc' } } }
    });

    // 2. If no session, create one with default data
    if (!dbSession) {
        dbSession = await prisma.testSession.create({
            data: {
                userId,
                title: "AP Calculus AB - Unit 4 Test Corrections",
                questions: {
                    create: MATH_TEST_SESSION.questions.map((q: any, i: number) => ({
                        text: q.text,
                        studentResponse: q.student_response,
                        rubric: JSON.stringify(q.rubric),
                        vocabulary: JSON.stringify(q.vocabulary || []),
                        orderIndex: i
                    }))
                }
            },
            include: { questions: true }
        });
    }

    // 3. Transform to App Format
    return {
        id: dbSession.id,
        title: dbSession.title,
        questions: dbSession.questions.map(q => ({
            id: q.id,
            text: q.text,
            student_response: q.studentResponse,
            image_url: q.imageUrl || undefined,
            rubric: JSON.parse(q.rubric || "[]"),
            vocabulary: JSON.parse(q.vocabulary || "[]"),
        }))
    };
}

export async function addQuestionAction(sessionId: string, orderIndex: number) {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Unauthorized");

    const newQ = await prisma.question.create({
        data: {
            sessionId,
            text: "",
            studentResponse: "",
            rubric: "[]",
            vocabulary: "[]",
            orderIndex
        }
    });

    return {
        id: newQ.id,
        text: newQ.text,
        student_response: newQ.studentResponse,
        rubric: [],
        vocabulary: []
    };
}

export async function updateQuestionAction(questionId: string, field: string, value: any) {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Unauthorized");

    // Map App fields to DB fields
    const dbFieldMap: Record<string, string> = {
        'text': 'text',
        'student_response': 'studentResponse',
        'image_url': 'imageUrl',
    };

    let data: any = {};

    if (field === 'rubric' || field === 'vocabulary') {
        data[field] = JSON.stringify(value);
    } else if (dbFieldMap[field]) {
        data[dbFieldMap[field]] = value;
    } else {
        // Fallback or ignore
        return;
    }

    await prisma.question.update({
        where: { id: questionId },
        data
    });
}

export async function removeQuestionAction(questionId: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Unauthorized");

    await prisma.question.delete({
        where: { id: questionId }
    });
}
