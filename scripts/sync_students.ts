import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import path from 'path'

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)
const prisma = new PrismaClient()

async function sync() {
    console.log('Fetching students from Supabase...')
    const { data: students, error } = await supabase
        .from('students')
        .select('*')
        .eq('is_active', true)
        .ilike('class_period', '%7th Grade Math%')

    if (error) {
        console.error('Error fetching students:', error)
        return
    }

    console.log(`Found ${students.length} students. Syncing to local SQLite...`)

    for (const student of students) {
        if (!student.google_email) continue

        const localIdToSet: string | null = student.student_local_id || null

        const emailUser = await prisma.user.upsert({
            where: { email: student.google_email },
            update: {
                name: student.name,
                classPeriod: student.class_period,
                role: 'student'
            },
            create: {
                email: student.google_email,
                name: student.name,
                classPeriod: student.class_period,
                role: 'student'
            }
        })

        if (localIdToSet) {
            const localOnly = await prisma.user.findFirst({
                where: { localId: localIdToSet, email: null }
            })

            if (localOnly) {
                const responses = await prisma.studentResponse.findMany({
                    where: { userId: localOnly.id }
                })

                for (const r of responses) {
                    const existing = await prisma.studentResponse.findUnique({
                        where: {
                            userId_sessionId_questionId: {
                                userId: emailUser.id,
                                sessionId: r.sessionId,
                                questionId: r.questionId
                            }
                        }
                    })

                    if (!existing) {
                        await prisma.studentResponse.create({
                            data: {
                                userId: emailUser.id,
                                sessionId: r.sessionId,
                                questionId: r.questionId,
                                initialReasoning: r.initialReasoning,
                                originalAnswer: r.originalAnswer,
                                difficulty: r.difficulty,
                                confidence: r.confidence,
                                revisedAnswer: r.revisedAnswer,
                                summary: r.summary
                            }
                        })
                    }
                }

                await prisma.studentResponse.deleteMany({ where: { userId: localOnly.id } })
                await prisma.user.delete({ where: { id: localOnly.id } })
            }

            await prisma.user.update({
                where: { id: emailUser.id },
                data: { localId: localIdToSet }
            })
        }
    }

    console.log('Sync complete!')
}

sync()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
