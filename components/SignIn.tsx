"use client";

import { signInAction, signOutAction, getSessionAction } from "@/app/auth-actions";
import { useState, useEffect } from "react";

export function SignIn() {
    const [user, setUser] = useState<{ name?: string | null; email?: string | null } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getSessionAction().then((session) => {
            setUser(session?.user || null);
            setLoading(false);
        });
    }, []);

    if (loading) return null;

    if (user) {
        return (
            <div className="flex items-center gap-4">
                <span className="text-sm text-zinc-500 font-medium hidden md:inline-block">
                    {user.name || user.email}
                </span>
                <button
                    onClick={async () => await signOutAction()}
                    className="text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-600 px-3 py-1.5 rounded-md font-medium transition-colors"
                >
                    Sign Out
                </button>
            </div>
        )
    }

    return (
        <button
            onClick={async () => await signInAction()}
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-md font-medium shadow-sm transition-colors flex items-center gap-2"
        >
            <span>Sign In</span>
        </button>
    )
}
