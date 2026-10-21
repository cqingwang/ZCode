import { z } from "zod";
import { remoteHostIdFromWorkspaceIdentity } from "@zcode/shared";
import type { DatabaseSync } from "node:sqlite";
import type {
  GroupNode,
  GroupTaskFact,
  GroupTaskRef,
  ITaskGroupService,
} from "#src/task-groups/contract.js";
import { TaskGroupRepository, groupTaskKey } from "#src/task-groups/repository.js";
export { TaskGroupRepository, groupTaskKey } from "#src/task-groups/repository.js";
export { ITaskGroupService } from "#src/task-groups/contract.js";
export type {
  TaskGroup,
  TaskGroupColor,
  TaskGroupStructure,
  GroupTaskRef,
  GroupNode,
  MoveGroupNode,
  GroupTaskFact,
} from "#src/task-groups/contract.js";

const taskRefSchema = z
  .object({
    hostId: z.string().min(1),
    workspacePath: z.string().min(1),
    workspaceIdentity: z.string().trim().min(1).optional(),
    taskId: z.string().min(1),
  })
  .strict();
const nodeRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("group"), groupId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("task"), task: taskRefSchema }).strict(),
]);
export function createTaskGroupService(options: {
  database(): Promise<DatabaseSync>;
  resolveTasks(tasks: GroupTaskRef[]): Promise<GroupTaskFact[]>;
  afterChange(): Promise<void>;
  /** 当前持库 Host；独立 Server 用它识别客户端未携带 identity 时的 local 默认值。 */
  ownerHostId?: string;
}): ITaskGroupService {
  const ownerHostId = options.ownerHostId?.trim() || "local";
  const normalizeTaskRef = (task: GroupTaskRef): GroupTaskRef => {
    // 显式 identity（包括非远程 identity）是权威；只有完全没有 identity 时才修正 local 默认值。
    if (task.workspaceIdentity?.trim()) return task;
    return task.hostId === "local" && ownerHostId !== "local"
      ? { ...task, hostId: ownerHostId }
      : task;
  };
  const assertTaskRef = (task: GroupTaskRef) => {
    const identity = task.workspaceIdentity?.trim();
    if (identity) {
      // 非远程 identity 沿用旧语义视为 local；远程 identity 必须与 hostId 一致。
      const identityHost = remoteHostIdFromWorkspaceIdentity(identity) ?? "local";
      if (identityHost !== task.hostId)
        throw new Error("task-group.host-identity-mismatch");
      return;
    }
    // 无 identity 的引用只能指向持库 Host，避免把任意 hostId 透传给项目路由。
    if (task.hostId !== ownerHostId) throw new Error("task-group.host-identity-mismatch");
  };
  const normalizeNode = (node: GroupNode): GroupNode =>
    node.type === "task" ? { ...node, task: normalizeTaskRef(node.task) } : node;
  const assertNode = (node: GroupNode) => {
    if (node.type === "task") assertTaskRef(node.task);
  };
  const repository = async () => new TaskGroupRepository(await options.database());
  const changed = async (run: (repo: TaskGroupRepository) => void) => {
    const repo = await repository();
    run(repo);
    await options.afterChange();
  };
  return {
    read: async () => (await repository()).read(),
    async save(input) {
      const parsed = z
        .object({
          id: z.string().min(1).optional(),
          title: z.string().trim().min(1).max(200).optional(),
          color: z.enum(["gray", "red", "orange", "yellow", "green", "blue", "purple"]).optional(),
        })
        .strict()
        .parse(input);
      const result = (await repository()).save(parsed);
      await options.afterChange();
      return result;
    },
    async ungroup(id) {
      await changed((repo) => repo.ungroup(z.string().min(1).parse(id)));
    },
    async move(input) {
      const parsed = z
        .object({
          node: nodeRefSchema,
          sourceGroupId: z.string().min(1).nullable(),
          groupId: z.string().min(1).nullable(),
          anchor: z
            .object({ node: nodeRefSchema, side: z.enum(["before", "after"]) })
            .strict()
            .optional(),
        })
        .strict()
        .parse(input);
      const normalized = {
        ...parsed,
        node: normalizeNode(parsed.node),
        ...(parsed.anchor
          ? { anchor: { ...parsed.anchor, node: normalizeNode(parsed.anchor.node) } }
          : {}),
      };
      assertNode(normalized.node);
      if (normalized.anchor) assertNode(normalized.anchor.node);
      const refs = [normalized.node, normalized.anchor?.node].flatMap((node) =>
        node?.type === "task" ? [node.task] : [],
      );
      const facts = await options.resolveTasks(refs);
      if (
        facts.length !== refs.length ||
        refs.some(
          (ref) =>
            !facts.some(
              (task) =>
                groupTaskKey(task) === groupTaskKey(ref) &&
                task.hostId === ref.hostId &&
                task.workspacePath === ref.workspacePath &&
                !task.deleted &&
                !task.archived,
            ),
        )
      )
        throw new Error("task-group.task-unavailable");
      await changed((repo) => repo.move(normalized));
    },
    async admit(input) {
      const parsed = z
        .object({
          tasks: z.array(taskRefSchema).max(10000),
          placement: z
            .object({
              task: taskRefSchema,
              groupId: z.string().min(1).nullable(),
              creationId: z.string().min(1),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(input);
      const normalized = {
        tasks: parsed.tasks.map(normalizeTaskRef),
        ...(parsed.placement
          ? {
              placement: {
                ...parsed.placement,
                task: normalizeTaskRef(parsed.placement.task),
              },
            }
          : {}),
      };
      normalized.tasks.forEach(assertTaskRef);
      if (normalized.placement) assertTaskRef(normalized.placement.task);
      const facts = await options.resolveTasks(normalized.tasks);
      if (
        normalized.placement &&
        !facts.some(
          (task) =>
            groupTaskKey(task) === groupTaskKey(normalized.placement!.task) &&
            task.hostId === normalized.placement!.task.hostId &&
            task.workspacePath === normalized.placement!.task.workspacePath &&
            !task.deleted,
        )
      )
        throw new Error("task-group.created-task-unavailable");
      const db = await options.database();
      const before = db.prepare("SELECT total_changes() AS n").get()?.n;
      new TaskGroupRepository(db).admit(facts, normalized.placement);
      if (db.prepare("SELECT total_changes() AS n").get()?.n !== before)
        await options.afterChange();
    },
  };
}
