"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { MATH_TEST_SESSION } from "@/lib/lessons";


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
        where: { userId: targetUserId, isActive: true },
        include: { questions: { orderBy: { orderIndex: 'asc' } } }
    });

    if (!dbSession) {
        dbSession = await prisma.testSession.findFirst({
            where: { userId: targetUserId },
            orderBy: { createdAt: "desc" },
            include: { questions: { orderBy: { orderIndex: 'asc' } } }
        });
    }

    // 4. Fallback: If current user is Admin and no session exists, create it
    if (!dbSession && session?.user?.email === adminEmail) {
        dbSession = await prisma.testSession.create({
            data: {
                userId: targetUserId,
                title: "AP Calculus AB - Unit 4 Test Corrections",
                isActive: true,
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

    let studentResponses: Record<string, any> = {};
    let studentLockIndex: number | null = null;
    let studentCurrentIndex: number | null = null;
    if (session?.user?.id) {
        const responses = await prisma.studentResponse.findMany({
            where: {
                userId: session.user.id,
                sessionId: dbSession.id
            }
        });

        studentResponses = responses.reduce((acc: Record<string, any>, r) => {
            acc[r.questionId] = {
                id: r.id,
                questionId: r.questionId,
                initialReasoning: r.initialReasoning,
                originalAnswer: r.originalAnswer,
                difficulty: r.difficulty,
                confidence: r.confidence,
                revisedAnswer: r.revisedAnswer,
                summary: r.summary
            };
            return acc;
        }, {});

        const lock = await prisma.studentSessionLock.findUnique({
            where: {
                sessionId_userId: {
                    sessionId: dbSession.id,
                    userId: session.user.id,
                }
            }
        });
        studentLockIndex = lock?.maxQuestionIndex ?? null;

        const state = await prisma.studentSessionState.findUnique({
            where: {
                sessionId_userId: {
                    sessionId: dbSession.id,
                    userId: session.user.id,
                }
            }
        });
        studentCurrentIndex = state?.currentQuestionIndex ?? null;
    }

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
        })),
        studentResponses,
        lockQuestionIndex: dbSession.lockQuestionIndex ?? null,
        studentLockIndex,
        studentCurrentIndex
    };
}

export async function createSessionAction(title?: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const created = await prisma.testSession.create({
        data: {
            userId: targetUserId,
            title: title?.trim() || "New Session",
            isActive: false,
        },
        include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    return {
        id: created.id,
        title: created.title,
        lockQuestionIndex: created.lockQuestionIndex ?? null,
        studentLockIndex: null,
        studentCurrentIndex: null,
        studentProfile: null,
        questions: created.questions.map((q: any) => ({
            id: q.id,
            text: q.text,
            student_response: q.studentResponse,
            image_url: q.imageUrl || undefined,
            rubric: JSON.parse(q.rubric || "[]"),
            vocabulary: JSON.parse(q.vocabulary || "[]"),
        })),
        studentResponses: {},
    };
}

export async function fetchSessionsList() {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const sessions = await prisma.testSession.findMany({
        where: { userId: targetUserId },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, createdAt: true, isActive: true },
    });

    return sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        isActive: s.isActive,
    }));
}

export async function fetchSessionById(sessionId: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const dbSession = await prisma.testSession.findFirst({
        where: { id: sessionId, userId: targetUserId },
        include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    if (!dbSession) {
        return { questions: [], groups: [] };
    }

    return {
        id: dbSession.id,
        title: dbSession.title,
        lockQuestionIndex: dbSession.lockQuestionIndex ?? null,
        studentLockIndex: null,
        studentCurrentIndex: null,
        studentProfile: null,
        questions: dbSession.questions.map((q: any) => ({
            id: q.id,
            text: q.text,
            student_response: q.studentResponse,
            image_url: q.imageUrl || undefined,
            rubric: JSON.parse(q.rubric || "[]"),
            vocabulary: JSON.parse(q.vocabulary || "[]"),
        })),
        studentResponses: {},
    };
}

export async function setSessionLock(sessionId: string, maxQuestionIndex: number | null) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    await prisma.testSession.update({
        where: { id: sessionId },
        data: { lockQuestionIndex: maxQuestionIndex },
    });
}

export async function setStudentLock(sessionId: string, userId: string, maxQuestionIndex: number | null) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    if (maxQuestionIndex === null) {
        await prisma.studentSessionLock.deleteMany({
            where: { sessionId, userId },
        });
        return;
    }

    await prisma.studentSessionLock.upsert({
        where: { sessionId_userId: { sessionId, userId } },
        update: { maxQuestionIndex },
        create: { sessionId, userId, maxQuestionIndex },
    });
}

export async function fetchSessionProgress(sessionId: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const dbSession = await prisma.testSession.findFirst({
        where: { id: sessionId, userId: targetUserId },
        include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    if (!dbSession) {
        return { questions: [], students: [], lockQuestionIndex: null };
    }

    const responses = await prisma.studentResponse.findMany({
        where: { sessionId },
        include: { user: true, question: true },
    });

    const keyUserId = session?.user?.id || "";
    const keyByQuestionId = new Map<string, string>();
    responses
        .filter((r) => r.userId === keyUserId)
        .forEach((r) => keyByQuestionId.set(r.questionId, r.originalAnswer || ""));

    const studentLocks = await prisma.studentSessionLock.findMany({
        where: { sessionId },
    });
    const lockByUserId = new Map(studentLocks.map((l) => [l.userId, l.maxQuestionIndex]));

    const studentMap: Record<string, any> = {};
    responses
        .filter((r) => r.userId !== keyUserId)
        .forEach((r) => {
            const user = r.user;
            if (!studentMap[user.id]) {
                studentMap[user.id] = {
                    id: user.id,
                    name: user.name || "Unknown",
                    classPeriod: user.classPeriod || "Unassigned",
                    localId: user.localId || null,
                    lockQuestionIndex: lockByUserId.get(user.id) ?? null,
                    progress: {},
                };
            }
            const hasCompleted = !!(r.initialReasoning && r.difficulty && r.confidence);
            const hasAny = !!(r.initialReasoning || r.difficulty || r.confidence || r.originalAnswer);
            studentMap[user.id].progress[r.questionId] = {
                status: hasCompleted ? "completed" : hasAny ? "in_progress" : "not_started",
                originalAnswer: r.originalAnswer || "",
                revisedAnswer: r.revisedAnswer || "",
                correctAnswer: keyByQuestionId.get(r.questionId) || "",
                summary: r.summary || "",
            };
        });

    const questions = dbSession.questions.map((q) => ({
        id: q.id,
        text: q.text,
        orderIndex: q.orderIndex,
    }));

    return {
        questions,
        students: Object.values(studentMap),
        lockQuestionIndex: dbSession.lockQuestionIndex ?? null,
    };
}

export async function setStudentCurrentQuestion(sessionId: string, questionIndex: number) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error("Unauthorized");
    }

    await prisma.studentSessionState.upsert({
        where: { sessionId_userId: { sessionId, userId: session.user.id } },
        update: { currentQuestionIndex: questionIndex },
        create: { sessionId, userId: session.user.id, currentQuestionIndex: questionIndex },
    });
}

export async function getAppConfig() {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const config = await prisma.appConfig.findFirst();
    return {
        baseUrl: config?.baseUrl || "",
        apiKey: config?.apiKey || "",
        model: config?.model || "",
        systemPrompt: config?.systemPrompt || "",
    };
}

export async function saveAppConfig(input: { baseUrl: string; apiKey: string; model: string; systemPrompt?: string }) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const existing = await prisma.appConfig.findFirst();
    if (!existing) {
        await prisma.appConfig.create({
            data: {
                baseUrl: input.baseUrl || null,
                apiKey: input.apiKey || null,
                model: input.model || null,
                systemPrompt: input.systemPrompt || null,
            },
        });
        return;
    }

    await prisma.appConfig.update({
        where: { id: existing.id },
        data: {
            baseUrl: input.baseUrl || null,
            apiKey: input.apiKey || null,
            model: input.model || null,
            systemPrompt: input.systemPrompt || null,
        },
    });
}

export async function fetchModelList(baseUrl: string, apiKey: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    if (!baseUrl) return [];
    let normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    if (normalizedBase.endsWith("/v1")) {
        normalizedBase = normalizedBase.slice(0, -3);
    }
    const url = `${normalizedBase}/v1/models`;
    const res = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to fetch models");
    }
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data : [];
    return models.map((m: any) => m.id).filter(Boolean);
}

export async function setActiveSession(sessionId: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    await prisma.testSession.updateMany({
        where: { userId: targetUserId, isActive: true },
        data: { isActive: false },
    });

    await prisma.testSession.update({
        where: { id: sessionId },
        data: { isActive: true },
    });
}

export async function deleteSessionAction(sessionId: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const result = await prisma.testSession.deleteMany({
        where: { id: sessionId, userId: targetUserId },
    });
    return result.count;
}

export async function fetchSessionStudentSummary(sessionId: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    const dbSession = await prisma.testSession.findFirst({
        where: { id: sessionId, userId: targetUserId },
        select: { id: true },
    });

    if (!dbSession) {
        return { questions: [], groups: [] };
    }

    const totalQuestions = await prisma.question.count({
        where: { sessionId },
    });

    const responseCounts = await prisma.studentResponse.groupBy({
        by: ["userId"],
        where: { sessionId },
        _count: { _all: true },
    });

    const userIds = responseCounts.map((r) => r.userId);
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, localId: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const students = responseCounts
        .map((r) => {
            const user = userById.get(r.userId);
            const answerCount = r._count._all;
            return {
                id: r.userId,
                name: user?.name || "Unknown",
                email: user?.email || null,
                localId: user?.localId || null,
                answers: answerCount,
                missing: Math.max(totalQuestions - answerCount, 0),
            };
        })
        .sort((a, b) => b.answers - a.answers);

    return {
        totalQuestions,
        students,
    };
}

function normalizeAnswer(value: string | null | undefined) {
    if (!value) return "";
    return value
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\w.\-+/= ]/g, "")
        .trim();
}

export async function fetchSessionAnswerMatrix(sessionId: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error("Unauthorized");
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session.user.id;

    const dbSession = await prisma.testSession.findFirst({
        where: { id: sessionId, userId: targetUserId },
        include: { questions: { orderBy: { orderIndex: "asc" } } },
    });

    if (!dbSession) {
        return { questions: [], groups: [] };
    }

    const responses = await prisma.studentResponse.findMany({
        where: { sessionId },
        include: { user: true },
    });

    const keyUserId = session.user.id;
    const keyByQuestionId = new Map<string, string>();
    responses
        .filter((r) => r.userId === keyUserId)
        .forEach((r) => {
            keyByQuestionId.set(r.questionId, r.originalAnswer || "");
        });

    const students = responses
        .filter((r) => r.userId !== keyUserId)
        .reduce((acc: Record<string, any>, r) => {
            const user = r.user;
            const entry = acc[user.id] || {
                id: user.id,
                name: user.name || "Unknown",
                classPeriod: user.classPeriod || "Unassigned",
                localId: user.localId || null,
                answers: {},
            };
            entry.answers[r.questionId] = r.originalAnswer || "";
            acc[user.id] = entry;
            return acc;
        }, {});

    const classGroups: Record<string, any[]> = {};
    Object.values(students).forEach((s: any) => {
        if (!classGroups[s.classPeriod]) classGroups[s.classPeriod] = [];
        classGroups[s.classPeriod].push(s);
    });

    const questions = dbSession.questions.map((q) => ({
        id: q.id,
        text: q.text,
        key: keyByQuestionId.get(q.id) || "",
    }));

    const grouped = Object.entries(classGroups).map(([classPeriod, studentList]) => {
        const byQuestion = questions.map((q) => {
            const correct: string[] = [];
            const incorrect: string[] = [];
            const missing: string[] = [];
            const freq = new Map<string, number>();
            studentList.forEach((s: any) => {
                const raw = s.answers[q.id] || "";
                if (!raw) {
                    missing.push(s.name);
                    return;
                }
                const norm = normalizeAnswer(raw);
                freq.set(norm, (freq.get(norm) || 0) + 1);
                if (q.key) {
                    if (normalizeAnswer(raw) === normalizeAnswer(q.key)) {
                        correct.push(s.name);
                    } else {
                        incorrect.push(s.name);
                    }
                } else {
                    missing.push(s.name);
                }
            });
            let suggestedAnswer = "";
            let suggestedCount = 0;
            for (const [answer, count] of freq.entries()) {
                if (count > suggestedCount) {
                    suggestedCount = count;
                    suggestedAnswer = answer;
                }
            }
            return {
                questionId: q.id,
                text: q.text,
                key: q.key,
                suggestedAnswer,
                suggestedCount,
                correct,
                incorrect,
                missing,
            };
        });
        return {
            classPeriod,
            questions: byQuestion,
        };
    });

    return {
        questions,
        groups: grouped,
    };
}

export async function setAnswerKey(sessionId: string, questionId: string, answerKey: string) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error("Unauthorized");
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session.user.id;

    const dbSession = await prisma.testSession.findFirst({
        where: { id: sessionId, userId: targetUserId },
        select: { id: true },
    });

    if (!dbSession) {
        throw new Error("Session not found");
    }

    await prisma.studentResponse.upsert({
        where: {
            userId_sessionId_questionId: {
                userId: session.user.id,
                sessionId,
                questionId,
            },
        },
        update: {
            originalAnswer: answerKey,
        },
        create: {
            userId: session.user.id,
            sessionId,
            questionId,
            originalAnswer: answerKey,
        },
    });
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

export async function updateSessionTitleAction(sessionId: string, title: string) {
    const session = await auth();
    const adminEmail = process.env.ADMIN_EMAIL;

    const adminUser = adminEmail
        ? await prisma.user.findUnique({ where: { email: adminEmail } })
        : null;

    const targetUserId = adminUser?.id || session?.user?.id;

    if (!targetUserId) {
        throw new Error("Unauthorized");
    }

    await prisma.testSession.update({
        where: { id: sessionId },
        data: { title },
    });
}

export async function removeQuestionAction(questionId: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Unauthorized");

    await prisma.question.delete({
        where: { id: questionId }
    });
}
