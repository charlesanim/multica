"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  integrationListOptions,
  useCreateIntegration,
  useUpdateIntegration,
  useDeleteIntegration,
} from "@multica/core/integrations";
import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import type { IntegrationProvider, Integration } from "@multica/core/types";

export function IntegrationsTab() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const { data: integrations = [], isLoading } = useQuery(integrationListOptions(wsId));
  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const deleteIntegration = useDeleteIntegration();

  const linearIntegration = integrations.find((i) => i.provider === "linear");
  const githubIntegration = integrations.find((i) => i.provider === "github");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Integrations</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect external issue trackers to automatically import work items.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          <IntegrationCard
            provider="linear"
            title="Linear"
            description="Import Linear issues when they reach active states (e.g., Todo). Status syncs back when agents complete work."
            integration={linearIntegration}
            webhookSlug={workspace?.slug}
            onCreate={() =>
              createIntegration.mutate({
                provider: "linear",
                config: { active_states: ["Todo"] },
              })
            }
            onToggle={(id, enabled) =>
              updateIntegration.mutate({ id, enabled })
            }
            onDelete={(id) => deleteIntegration.mutate(id)}
            onUpdate={(id, config) =>
              updateIntegration.mutate({ id, config })
            }
            onUpdateSecret={(id, webhook_secret) =>
              updateIntegration.mutate({ id, webhook_secret })
            }
          />

          <IntegrationCard
            provider="github"
            title="GitHub Issues"
            description="Import GitHub issues into Multica. Agents pick them up and close the GitHub issue when done."
            integration={githubIntegration}
            webhookSlug={workspace?.slug}
            onCreate={() =>
              createIntegration.mutate({
                provider: "github",
                config: { owner: "", repo: "", labels: [] },
              })
            }
            onToggle={(id, enabled) =>
              updateIntegration.mutate({ id, enabled })
            }
            onDelete={(id) => deleteIntegration.mutate(id)}
            onUpdate={(id, config) =>
              updateIntegration.mutate({ id, config })
            }
            onUpdateSecret={(id, webhook_secret) =>
              updateIntegration.mutate({ id, webhook_secret })
            }
          />
        </>
      )}
    </div>
  );
}

interface IntegrationCardProps {
  provider: IntegrationProvider;
  title: string;
  description: string;
  integration?: Integration;
  webhookSlug?: string;
  onCreate: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, config: Record<string, unknown>) => void;
  onUpdateSecret: (id: string, secret: string) => void;
}

function IntegrationCard({
  provider,
  title,
  description,
  integration,
  webhookSlug,
  onCreate,
  onToggle,
  onDelete,
  onUpdate,
  onUpdateSecret,
}: IntegrationCardProps) {
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState("");

  if (!integration) {
    return (
      <div className="border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Connect
          </Button>
        </div>
      </div>
    );
  }

  const webhookUrl = webhookSlug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/${webhookSlug}/webhooks/${provider}`
    : "";

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-medium">{title}</h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              integration.enabled
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {integration.enabled ? "Active" : "Paused"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle(integration.id, !integration.enabled)}
            title={integration.enabled ? "Pause" : "Enable"}
          >
            {integration.enabled ? (
              <ToggleRight className="h-4 w-4" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Done" : "Configure"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(integration.id)}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Webhook URL */}
      {webhookUrl && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Webhook URL
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-1.5 rounded overflow-x-auto">
              {webhookUrl}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigator.clipboard.writeText(webhookUrl)}
            >
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {provider === "linear"
              ? "Add this URL in Linear → Settings → API → Webhooks"
              : "Add this URL in GitHub → Repo Settings → Webhooks"}
          </p>
        </div>
      )}

      {/* Signing secret */}
      {webhookUrl && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            {provider === "linear" ? "Signing Secret" : "Webhook Secret"}
          </label>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1 text-xs font-mono"
              type="password"
              placeholder={provider === "linear" ? "Paste the signing secret from Linear" : "Paste the secret from GitHub"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!secret}
              onClick={() => {
                onUpdateSecret(integration.id, secret);
                setSecret("");
              }}
            >
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {provider === "linear"
              ? "Linear provides this when you create the webhook. Paste it here to verify payloads."
              : "Set a secret in GitHub webhook settings. Paste the same value here."}
          </p>
        </div>
      )}

      {/* Config editing */}
      {editing && (
        <IntegrationConfigEditor
          provider={provider}
          config={integration.config as Record<string, unknown>}
          onSave={(config) => {
            onUpdate(integration.id, config);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function IntegrationConfigEditor({
  provider,
  config,
  onSave,
}: {
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const [local, setLocal] = useState(config);

  if (provider === "linear") {
    return (
      <div className="space-y-3 border-t pt-4">
        <div>
          <label className="text-xs font-medium">Active States</label>
          <Input
            className="mt-1"
            placeholder="Todo, In Progress"
            value={((local.active_states as string[]) ?? []).join(", ")}
            onChange={(e) =>
              setLocal({
                ...local,
                active_states: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          <p className="text-xs text-muted-foreground mt-1">
            Comma-separated Linear states that trigger import
          </p>
        </div>
        <Button size="sm" onClick={() => onSave(local)}>
          Save
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium">Owner</label>
          <Input
            className="mt-1"
            placeholder="github-org"
            value={(local.owner as string) ?? ""}
            onChange={(e) => setLocal({ ...local, owner: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium">Repository</label>
          <Input
            className="mt-1"
            placeholder="my-repo"
            value={(local.repo as string) ?? ""}
            onChange={(e) => setLocal({ ...local, repo: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">Labels filter</label>
        <Input
          className="mt-1"
          placeholder="agent-work, bug (leave empty for all issues)"
          value={((local.labels as string[]) ?? []).join(", ")}
          onChange={(e) =>
            setLocal({
              ...local,
              labels: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
        <p className="text-xs text-muted-foreground mt-1">
          Only import issues with these labels (leave empty for all)
        </p>
      </div>
      <Button size="sm" onClick={() => onSave(local)}>
        Save
      </Button>
    </div>
  );
}
