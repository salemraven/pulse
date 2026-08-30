import { createFileRoute } from "@tanstack/react-router";
import { PulseApp } from "@/components/pulse/pulse-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PulseApp />;
}
