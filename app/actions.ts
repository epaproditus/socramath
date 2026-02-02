"use server";

import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";
import { MATH_TEST_SESSION } from "@/lib/lessons";

const prisma = new PrismaClient();

export async function fetchUserSession() {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    // 1. Find the Admin User in our DB
    const adminUser = adminEmail ? await prisma.user.findUnique({
        where: { email: adminEmail }
    }) : null;

    // 2. Identify whose session we are looking for
    // If not logged in, or if logged in as anyone else, we prefer the Admin's session
    const targetUserId = adminUser?.id;

    if (!targetUserId) {
        console.log("No admin user found in DB yet. Admin needs to log in first.");
        return null;
    }

    // 3. Fetch the latest session for the Admin
    let dbSession = await prisma.testSession.findFirst({
        where: { userId: targetUserId },
        include: { questions: { orderBy: { orderIndex: 'asc' } } }
    });

    // 4. Fallback: If current user is Admin and no session exists, create it
    if (!dbSession && session?.user?.email === adminEmail) {
        dbSession = await prisma.testSession.create({
            data: {
                userId: targetUserId,
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

    if (!dbSession) return null;

    // 6. Fetch Student Profile for personalization
    let studentProfile = null;
    if (session?.user?.email && session.user.email !== adminEmail) {
        const dbUser = await prisma.user.findUnique({
            where: { email: session.user.email }
        });
        if (dbUser) {
            studentProfile = {
                name: dbUser.name,
                classPeriod: dbUser.classPeriod
            };
        }
    }

    // 7. Transform to App Format
    return {
        id: dbSession.id,
        title: dbSession.title,
        studentProfile,
        questions: dbSession.questions.map((q: any) => ({
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
