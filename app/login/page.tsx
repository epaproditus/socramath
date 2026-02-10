import { signInWithCredentialsAction } from "@/app/auth-actions";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold text-zinc-900">Sign in</div>
        <div className="mt-1 text-sm text-zinc-500">
          Enter any password for now.
        </div>
        <form action={signInWithCredentialsAction} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase text-zinc-500">
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              placeholder="student@school.org"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-zinc-500">
              Password
            </label>
            <input
              name="password"
              type="password"
              required
              className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
              placeholder="anything works for now"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
