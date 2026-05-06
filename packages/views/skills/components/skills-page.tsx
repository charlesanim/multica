"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  FileSearch,
  Globe,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import type {
  AgentRuntime,
  MemberWithUser,
  Skill,
} from "@multica/core/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  agentListOptions,
  memberListOptions,
  selectSkillAssignments,
  skillListOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes";
import { Button } from "@multica/ui/components/ui/button";
import { DataTable } from "@multica/ui/components/ui/data-table";
import { Input } from "@multica/ui/components/ui/input";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@multica/ui/components/ui/tooltip";
import { useNavigation } from "../../navigation";
import { PageHeader } from "../../layout/page-header";
import { canEditSkill } from "../hooks/use-can-edit-skill";
import { readOrigin } from "../lib/origin";
import { CreateSkillDialog } from "./create-skill-dialog";
import { type SkillRow, createSkillColumns } from "./skill-columns";
import {
  SKILL_TEMPLATES,
  type SkillTemplate,
} from "./skill-templates";

type FilterKey = "all" | "used" | "unused" | "mine";

// ---------------------------------------------------------------------------
// Scope tab — matches Issues/MyIssues header pattern
// ---------------------------------------------------------------------------

const SCOPES: { value: FilterKey; label: string; description: string }[] = [
  { value: "all", label: "All", description: "All skills in this workspace" },
  { value: "used", label: "In use", description: "Skills assigned to at least one agent" },
  { value: "unused", label: "Unused", description: "Skills not assigned to any agent" },
  { value: "mine", label: "Created by me", description: "Skills you created" },
];

// ---------------------------------------------------------------------------
// Page header bar — uses shared PageHeader so the mobile sidebar trigger and
// h-12 chrome stay consistent with every other dashboard list page.
// ---------------------------------------------------------------------------

function PageHeaderBar({
  totalCount,
  onCreate,
}: {
  totalCount: number;
  onCreate: () => void;
}) {
  return (
    <PageHeader className="justify-between px-5">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Skills</h1>
        {totalCount > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">
            {totalCount}
          </span>
        )}
        {/* Tagline next to the title — single sentence + docs link. Hidden
            below md so it never collides with the title on narrow screens. */}
        <p className="ml-2 hidden text-xs text-muted-foreground md:block">
          Instructions any agent in this workspace can use.{" "}
          <a
            href="https://multica.ai/docs/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/30 underline-offset-4 transition-colors hover:text-foreground"
          >
            Learn more →
          </a>
        </p>
      </div>
      <Button type="button" size="sm" onClick={onCreate}>
        <Plus className="h-3 w-3" />
        New skill
      </Button>
    </PageHeader>
  );
}

// ---------------------------------------------------------------------------
// Card toolbar — search + scope filters, kept inside the card because they
// operate on the table content. Page-level actions (New skill) live in the
// PageHeader instead.
// ---------------------------------------------------------------------------

function CardToolbar({
  search,
  setSearch,
  filter,
  setFilter,
}: {
  search: string;
  setSearch: (v: string) => void;
  filter: FilterKey;
  setFilter: (v: FilterKey) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="h-8 w-64 pl-8 text-sm"
        />
      </div>
      {SCOPES.map((s) => (
        <Tooltip key={s.value}>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={
                  filter === s.value
                    ? "bg-accent text-accent-foreground hover:bg-accent/80"
                    : "text-muted-foreground"
                }
                onClick={() => setFilter(s.value)}
              >
                {s.label}
              </Button>
            }
          />
          <TooltipContent side="bottom">{s.description}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <BookOpen className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">No skills yet</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Create your first skill, import one from a URL, or copy one from a
        connected runtime — and every agent in the workspace can use it.
      </p>
      <Button type="button" onClick={onCreate} size="sm" className="mt-5">
        <Plus className="h-3 w-3" />
        New skill
      </Button>
    </div>
  );
}

function SuggestedSkills({
  installedNames,
  onInstalled,
}: {
  installedNames: Set<string>;
  onInstalled: (skill: Skill) => void;
}) {
  const wsId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [installing, setInstalling] = useState<string | null>(null);

  const templates = SKILL_TEMPLATES.filter(
    (template) => !installedNames.has(template.data.name.toLowerCase()),
  );

  if (templates.length === 0) return null;

  const installTemplate = async (template: SkillTemplate) => {
    setInstalling(template.id);
    try {
      const skill = await api.createSkill(template.data);
      await queryClient.invalidateQueries({
        queryKey: workspaceKeys.skills(wsId),
      });
      toast.success(`${template.name} skill added`);
      onInstalled(skill);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add suggested skill",
      );
    } finally {
      setInstalling(null);
    }
  };

  const iconFor = (template: SkillTemplate) =>
    template.icon === "globe" ? Globe : FileSearch;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium">Suggested skills</h2>
          <p className="text-xs text-muted-foreground">
            Start from workflow-ready instructions for common agent tasks.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {templates.map((template) => {
          const Icon = iconFor(template);
          const isInstalling = installing === template.id;
          return (
            <div
              key={template.id}
              className="flex items-start gap-3 rounded-md border bg-background p-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">{template.name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {template.description}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={installing !== null}
                onClick={() => installTemplate(template)}
              >
                {isInstalling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Add
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const {
    data: skills = [],
    isLoading,
    error: listError,
    refetch: refetchList,
  } = useQuery(skillListOptions(wsId));
  const { data: agents = [], error: agentsError } = useQuery(
    agentListOptions(wsId),
  );
  const { data: members = [], error: membersError } = useQuery(
    memberListOptions(wsId),
  );
  const { data: runtimes = [], error: runtimesError } = useQuery(
    runtimeListOptions(wsId),
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Derive assignments ONCE per agents-identity. Stable reference across
  // unrelated agent refetches — see selectSkillAssignments' doc.
  const assignments = useMemo(
    () => selectSkillAssignments(agents),
    [agents],
  );

  const membersById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const runtimesById = useMemo(() => {
    const map = new Map<string, AgentRuntime>();
    for (const r of runtimes) map.set(r.id, r);
    return map;
  }, [runtimes]);

  const myRole =
    members.find((m) => m.user_id === currentUserId)?.role ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byAssignment = (s: Skill) =>
      (assignments.get(s.id)?.length ?? 0) > 0;

    return skills.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.description.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (filter === "used" && !byAssignment(s)) return false;
      if (filter === "unused" && byAssignment(s)) return false;
      if (filter === "mine" && s.created_by !== currentUserId) return false;
      return true;
    });
  }, [skills, assignments, search, filter, currentUserId]);

  const installedSkillNames = useMemo(
    () => new Set(skills.map((skill) => skill.name.toLowerCase())),
    [skills],
  );

  const handleCreated = (skill: Skill) => {
    navigation.push(paths.skillDetail(skill.id));
  };

  // Assemble per-row data once per render — skill + agents + creator +
  // origin-runtime + permission flag. The table's column cells read off
  // `row.original` and never pull their own queries.
  const skillRows = useMemo<SkillRow[]>(() => {
    return filtered.map((skill) => {
      const origin = readOrigin(skill);
      const runtime =
        origin.type === "runtime_local" && origin.runtime_id
          ? runtimesById.get(origin.runtime_id) ?? null
          : null;
      return {
        skill,
        agents: assignments.get(skill.id) ?? [],
        creator: skill.created_by
          ? membersById.get(skill.created_by) ?? null
          : null,
        runtime,
        canEdit: canEditSkill(skill, {
          userId: currentUserId,
          role: myRole,
        }),
      };
    });
  }, [
    filtered,
    assignments,
    membersById,
    runtimesById,
    currentUserId,
    myRole,
  ]);

  const columns = useMemo(() => createSkillColumns(), []);

  const table = useReactTable({
    data: skillRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableColumnResizing: true,
  });

  // --- Loading ---
  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeaderBar totalCount={0} onCreate={() => setCreateOpen(true)} />
        <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
          <div className="space-y-3 pl-4">
            <Skeleton className="h-5 w-full max-w-2xl rounded-md" />
            <Skeleton className="h-14 w-full max-w-3xl rounded-md" />
          </div>
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <Skeleton className="h-8 w-64 rounded-md" />
              <Skeleton className="h-7 w-12 rounded-md" />
              <Skeleton className="h-7 w-14 rounded-md" />
              <Skeleton className="h-7 w-16 rounded-md" />
            </div>
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- List request error ---
  if (listError) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeaderBar totalCount={0} onCreate={() => setCreateOpen(true)} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm font-medium">Couldn&rsquo;t load skills</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {listError instanceof Error
                ? listError.message
                : "Something went wrong fetching the skill list."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetchList()}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const totalCount = skills.length;
  const showEmpty = totalCount === 0;
  const supportingQueryDown =
    !!agentsError || !!membersError || !!runtimesError;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeaderBar
        totalCount={totalCount}
        onCreate={() => setCreateOpen(true)}
      />

      {/* Non-blocking banner when supporting queries fail — list still renders
          but creator/runtime/permission attribution is incomplete. */}
      {supportingQueryDown && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 border-b bg-warning/10 px-6 py-2 text-xs text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            Some workspace data failed to load. Creator attribution, runtime
            names, or edit permissions may appear incomplete.
          </span>
        </div>
      )}

      {/* Page body — padding here keeps the card from touching the chrome,
          and `gap-4` separates the intro banner from the table card. */}
      <div className="flex flex-1 min-h-0 flex-col gap-4 p-6">
        {!showEmpty && (
          // Brand-coloured intro banner — explains the sharing model
          // for skills (workspace-wide vs. local runtime). Pre-#1794
          // this lived in the body; #1794 dropped it without a clear
          // reason. Restored intentionally.
          <div className="max-w-3xl rounded-r-md border-l-2 border-l-brand bg-brand/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              Shared with your workspace.
            </span>{" "}
            Anyone can create a skill, import one from a URL, or copy one
            from their local runtime — and every agent can use it.{" "}
            <span className="font-semibold text-brand">
              Local runtime skills stay private until you copy one here.
            </span>
          </div>
        )}
        <SuggestedSkills
          installedNames={installedSkillNames}
          onInstalled={handleCreated}
        />
        {showEmpty ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState onCreate={() => setCreateOpen(true)} />
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
            <CardToolbar
              search={search}
              setSearch={setSearch}
              filter={filter}
              setFilter={setFilter}
            />
            {filtered.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center text-muted-foreground">
                <Search className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm">No matches</p>
                <p className="max-w-xs text-xs">
                  {search
                    ? `No skills match "${search}"${filter !== "all" ? " in this filter" : ""}.`
                    : "No skills match this filter."}{" "}
                  Try a different query.
                </p>
              </div>
            ) : (
              <DataTable
                table={table}
                onRowClick={(row) =>
                  navigation.push(paths.skillDetail(row.original.skill.id))
                }
              />
            )}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateSkillDialog
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
