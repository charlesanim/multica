"use client";

import { WSProvider } from "@multica/core/realtime";
import { useAuthStore } from "./auth";
import { useWorkspaceStore } from "./workspace";
import { webStorage } from "./storage";
import { toast } from "sonner";

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  return "ws://localhost:8080/ws";
}

export function WebWSProvider({ children }: { children: React.ReactNode }) {
  return (
    <WSProvider
      wsUrl={getWsUrl()}
      authStore={useAuthStore}
      workspaceStore={useWorkspaceStore}
      storage={webStorage}
      onToast={(message, type) => {
        if (type === "error") toast.error(message);
        else toast.info(message);
      }}
    >
      {children}
    </WSProvider>
  );
}
