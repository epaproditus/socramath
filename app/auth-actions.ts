"use server"
import { signIn, signOut, auth } from "@/auth"
import { redirect } from "next/navigation";

export async function signInWithCredentialsAction(formData: FormData) {
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    await signIn("credentials", {
        email,
        password,
        redirectTo: "/",
    });
}

export async function signInAction() {
    redirect("/login");
}

export async function signOutAction() {
    await signOut();
}

export async function getSessionAction() {
    const session = await auth();
    return session ? { user: session.user } : null;
}
