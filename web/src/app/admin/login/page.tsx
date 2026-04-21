import { LoginForm } from "./login-form";

export const metadata = {
  title: "Admin Login — KCKILLS",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage({ searchParams }: { searchParams?: Promise<{ from?: string; token?: string }> }) {
  return <LoginForm searchParamsPromise={searchParams} />;
}
