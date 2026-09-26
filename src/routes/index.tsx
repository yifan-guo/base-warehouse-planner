import { createFileRoute } from "@tanstack/react-router";
import { FlowConsole } from "@/components/console/FlowConsole";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <FlowConsole />;
}
