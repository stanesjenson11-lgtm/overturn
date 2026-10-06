import AuthForm from "@/components/AuthForm";
import { IDLE_SECONDS } from "@/lib/auth/idle";

// ?expired=1 is set by the idle sign-out (components/IdleTimeout.tsx). A flag,
// never the email: a URL ends up in history, referrers and logs.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  const notice = expired
    ? `You were signed out after ${IDLE_SECONDS / 60} minutes without activity.`
    : undefined;
  return <AuthForm mode="login" notice={notice} />;
}
