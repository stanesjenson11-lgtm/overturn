import AuthForm from "@/components/AuthForm";
import { IDLE_SECONDS } from "@/lib/auth/idle";

// ?expired=1, ?ended=elsewhere and ?ended=1 are set by components/IdleTimeout.tsx:
// the idle sign-out, a newer sign-in on another browser, and any other server-side
// end (the 12-hour cap, "sign out of all devices"). Flags,
// never the email: a URL ends up in history, referrers and logs.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; ended?: string }>;
}) {
  const { expired, ended } = await searchParams;
  const notice =
    ended === "elsewhere"
      ? "You were signed out because your account signed in on another browser or device."
      : expired
        ? `You were signed out after ${IDLE_SECONDS / 60} minutes without activity.`
        : ended
          ? "Your session ended. Please sign in again."
          : undefined;
  return <AuthForm mode="login" notice={notice} />;
}
