"use server"
import { signIn, signOut, auth } from "@/auth"

export async function signInAction() {
    await signIn("google");
}

export async function signOutAction() {
    await signOut();
}

export async function getSessionAction() {
    const session = await auth();
    return session ? { user: session.user } : null;
}
