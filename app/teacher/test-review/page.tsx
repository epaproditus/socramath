import { auth } from "@/auth";
import TeacherDashboard from "@/components/TeacherDashboard";
import { SignIn } from "@/components/SignIn";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function TeacherTestReviewPage() {
  const session = await auth();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!session || !session.user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 space-y-4">
        <h1 className="text-xl font-bold">Teacher Access Required</h1>
        <p className="text-zinc-500 text-sm">Please sign in to view this page.</p>
        <SignIn />
        <Link
          href="/teacher"
          className="text-xs text-zinc-400 hover:text-indigo-500 flex items-center gap-1 mt-4"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Teacher Hub
        </Link>
      </div>
    );
  }

  if (adminEmail && session.user.email !== adminEmail) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 space-y-4 text-center p-4">
        <div className="bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-xl">
          <h1 className="text-xl font-bold mb-2">Access Denied</h1>
          <p className="text-sm">
            You are signed in as <strong>{session.user.email}</strong>.
          </p>
          <p className="text-sm">This account is not authorized to view the Teacher Dashboard.</p>
        </div>
        <SignIn />
        <Link
          href="/teacher"
          className="text-xs text-zinc-400 hover:text-indigo-500 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> Back to Teacher Hub
        </Link>
      </div>
    );
  }

  return <TeacherDashboard mode="prep" />;
}
