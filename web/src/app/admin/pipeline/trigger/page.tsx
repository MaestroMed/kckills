import { TriggerForm } from "./trigger-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Trigger Job — Admin",
  robots: { index: false, follow: false },
};

export default function TriggerPage() {
  return <TriggerForm />;
}
