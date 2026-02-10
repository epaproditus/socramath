"use server"
import { signIn, signOut, auth } from "@/auth"
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function signInWithCredentialsAction(formData: FormData) {
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host") || "";
    const proto = headerList.get("x-forwarded-proto") || "http";
    const baseUrl = host ? `${proto}://${host}` : "";
    await signIn("credentials", {
        email,
        password,
        redirectTo: baseUrl ? `${baseUrl}/` : "/",
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
