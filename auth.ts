import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import prisma from "@/lib/prisma"


export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: PrismaAdapter(prisma),
    trustHost: true,
    session: {
        strategy: "jwt",
    },
    providers: [
        Credentials({
            name: "Email",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                const email = String(credentials?.email || "").trim().toLowerCase();
                const password = String(credentials?.password || "").trim();
                if (!email || !password) return null;
                const user = await prisma.user.upsert({
                    where: { email },
                    update: {},
                    create: {
                        email,
                        name: email.split("@")[0] || "Student",
                    },
                });
                return { id: user.id, email: user.email, name: user.name };
            },
        }),
    ],
    pages: {
        signIn: "/login",
    },
    callbacks: {
        async jwt({ token, user }) {
            if (user && user.id) {
                token.sub = String(user.id);
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user && token?.sub) {
                (session.user as { id?: string }).id = String(token.sub);
            }
            return session;
        },
    },
})
