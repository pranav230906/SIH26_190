import type { Metadata } from "next";
import { WorkspaceFrame } from "@/components/workspace-frame";

export const metadata: Metadata = {
  title: "Workspace",
};

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>;
}
