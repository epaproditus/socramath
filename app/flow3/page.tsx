import { auth } from "@/auth";
import FlowThreeChat from "@/components/FlowThreeChat";
import { SignIn } from "@/components/SignIn";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function FlowThreePage() {
  const session = await auth();

  if (!session || !session.user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center space-y-4 bg-zinc-50 dark:bg-zinc-950">
        <h1 className="text-xl font-bold">Sign In Required</h1>
        <p className="text-sm text-zinc-500">Please sign in to open student Flow 3.</p>
        <SignIn />
        <Link
          href="/"
          className="mt-4 flex items-center gap-1 text-xs text-zinc-400 hover:text-indigo-500"
        >
          <ArrowLeft className="h-3 w-3" /> Back to Student View
        </Link>
      </div>
    );
  }

  return <FlowThreeChat />;
}
