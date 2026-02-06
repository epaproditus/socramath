import { auth } from "@/auth";
import { SignIn } from "@/components/SignIn";
import LessonStudentView from "@/components/LessonStudentView";

export default async function LessonPage() {
  const session = await auth();

  if (!session || !session.user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 space-y-4">
        <h1 className="text-xl font-bold">Sign In Required</h1>
        <p className="text-zinc-500 text-sm">Please sign in to view this lesson.</p>
        <SignIn />
      </div>
    );
  }

  return <LessonStudentView />;
}
