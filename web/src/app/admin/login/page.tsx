import { LoginForm } from "./login-form";

export const metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage({ searchParams }: { searchParams?: Promise<{ from?: string; next?: string; logout?: string }> }) {
  return <LoginForm searchParamsPromise={searchParams} />;
}
