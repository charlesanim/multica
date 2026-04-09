"use client";

import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "./store";
import { useWorkspaceStore } from "@/features/workspace";
import { api } from "@/shared/api";
import { createLogger } from "@/shared/logger";
import { setLoggedInCookie, clearLoggedInCookie } from "./auth-cookie";

const logger = createLogger("auth");

/**
 * Initializes auth + workspace state from localStorage on mount.
 * Fires getMe() and listWorkspaces() in parallel when a cached token exists.
 */
export function AuthInitializer({ children }: { children: ReactNode }) {
  useEffect(() => {
    const localMode =
      process.env.NEXT_PUBLIC_LOCAL_MODE === "true" ||
      process.env.NEXT_PUBLIC_LOCAL_MODE === "1";
    let token = localStorage.getItem("multica_token");
    const wsId = localStorage.getItem("multica_workspace_id");

    if (!token && !localMode) {
      clearLoggedInCookie();
      useAuthStore.setState({ isLoading: false });
      return;
    }

    const initialize = async () => {
      try {
        let user;
        if (!token) {
          const login = await api.localLogin();
          token = login.token;
          user = login.user;
          localStorage.setItem("multica_token", token);
          api.setToken(token);
        } else {
          api.setToken(token);
          user = await api.getMe();
        }

        const wsList = await api.listWorkspaces();
        setLoggedInCookie();
        useAuthStore.setState({ user, isLoading: false });
        useWorkspaceStore.getState().hydrateWorkspace(wsList, wsId);
      } catch (err) {
        logger.error("auth init failed", err);
        api.setToken(null);
        api.setWorkspaceId(null);
        localStorage.removeItem("multica_token");
        localStorage.removeItem("multica_workspace_id");
        clearLoggedInCookie();
        useAuthStore.setState({ user: null, isLoading: false });
      }
    };

    void initialize();
  }, []);

  return <>{children}</>;
}
