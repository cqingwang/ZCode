import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ProjectRepositoryContract, VirtualProject } from "#src/project-storage/contract.js";
import { createProjectService } from "#src/project/index.js";

it("PD07 同一草稿重复准备只分配一个目录，不影响无参调用", async () => {
  const root = await mkdtemp(join(tmpdir(), "task-draft-prepare-"));
  const service = createProjectService({ workspaceDirectory: root, repository: vi.fn() });
  const draftId = "cc29167e-5a72-4c24-9e31-adcc584c73b4";
  try {
    const [a, b] = await Promise.all([
      service.prepareSession({ draftId }),
      service.prepareSession({ draftId }),
    ]);
    expect(a.workspacePath).toBe(b.workspacePath);
    expect(await readdir(root)).toHaveLength(1);
    expect((await service.prepareSession()).workspacePath).not.toBe(a.workspacePath);
    await expect(service.prepareSession({ draftId: "../../escape" })).rejects.toThrow();
    expect(await readdir(root)).toHaveLength(2);
    await rm(a.workspacePath, { recursive: true });
    await expect(service.prepareSession({ draftId, reuseDraft: true })).rejects.toThrow();
    expect(await readdir(root)).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not return a preparation result after its project was deleted during directory validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "project-prepare-delete-"));
  const project = {
    id: "p",
    hostId: "remote:server:s",
    roots: [{ rootPath: root, isPrimary: true, position: 0 }],
  } as VirtualProject;
  const readTree = vi
    .fn()
    .mockReturnValueOnce({ projects: [project], tasks: [] })
    .mockReturnValue({ projects: [], tasks: [] });
  const service = createProjectService({
    ownerHostId: project.hostId,
    workspaceDirectory: root,
    repository: async () => ({ readTree }) as unknown as ProjectRepositoryContract,
  });
  try {
    await expect(service.prepareSession({ projectId: "p" })).rejects.toThrow("project.not-found");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects remote unclassified and empty-project creation before allocating a directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "remote-project-required-"));
  const initializeProjectRoot = vi.fn();
  const project = {
    id: "empty",
    roots: [],
    hostId: "remote:server:s",
  } as unknown as VirtualProject;
  const service = createProjectService({
    ownerHostId: project.hostId,
    workspaceDirectory: root,
    repository: async () =>
      ({
        readTree: () => ({ projects: [project], tasks: [] }),
        initializeProjectRoot,
      }) as unknown as ProjectRepositoryContract,
  });
  try {
    await expect(service.prepareSession()).rejects.toThrow("project.remote-project-required");
    await expect(service.prepareSession({ projectId: project.id })).rejects.toThrow(
      "project.remote-single-root-required",
    );
    // 直连客户端的 local 默认值表示当前持库 Host，不是另一台本机 Host；仍按远端单 root 约束拒绝。
    await expect(
      service.prepareSession({ hostId: "local", projectId: project.id }),
    ).rejects.toThrow("project.remote-single-root-required");
    expect(initializeProjectRoot).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("normalizes the client local host to the remote storage owner for existing sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "remote-local-host-"));
  const project = {
    id: "p",
    hostId: "remote:server:s",
    roots: [{ rootPath: root, isPrimary: true, position: 0 }],
  } as VirtualProject;
  const resolveSessionDirectories = vi.fn(() => ({
    projectId: project.id,
    workspacePath: root,
    additionalDirectories: [],
  }));
  const resolveHost = vi.fn();
  const service = createProjectService({
    ownerHostId: project.hostId,
    workspaceDirectory: root,
    resolveHost,
    repository: async () =>
      ({
        readTree: () => ({ projects: [project], tasks: [] }),
        resolveSessionDirectories,
      }) as unknown as ProjectRepositoryContract,
  });
  try {
    // Web 直连没有 workspaceIdentity，Composer 默认 hostId=local；必须命中持库 Host 的仓储。
    await expect(
      service.resolveSessionDirectories({ workspacePath: root, taskId: "session-1" }, "local"),
    ).resolves.toEqual({
      projectId: project.id,
      workspacePath: root,
      additionalDirectories: [],
    });
    expect(resolveSessionDirectories).toHaveBeenCalledWith({
      workspacePath: root,
      taskId: "session-1",
    });
    expect(resolveHost).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("maps a remote unclassified session onto the configured default project", async () => {
  const root = await mkdtemp(join(tmpdir(), "remote-default-project-"));
  const defaultRoot = join(root, ".zcode", "workspace", "default");
  const defaultProject = {
    id: "default",
    hostId: "remote:server:s",
    roots: [{ rootPath: defaultRoot, isPrimary: true, position: 0 }],
  } as VirtualProject;
  const readTree = vi
    .fn()
    .mockReturnValueOnce({ projects: [], tasks: [] })
    .mockReturnValue({
      projects: [defaultProject],
      tasks: [
        {
          taskId: "legacy-chat",
          workspacePath: defaultRoot,
          projectId: null,
          hostId: defaultProject.hostId,
        },
      ],
    });
  const saveProject = vi.fn(() => defaultProject);
  const moveTask = vi.fn();
  const service = createProjectService({
    ownerHostId: defaultProject.hostId,
    workspaceDirectory: root,
    defaultProjectRoot: defaultRoot,
    repository: async () =>
      ({ readTree, saveProject, moveTask }) as unknown as ProjectRepositoryContract,
  });
  try {
    // 默认工作区由服务幂等创建，用户无需先手动建目录。
    await expect(service.prepareSession()).resolves.toEqual({
      // UI 仍按“不在项目中工作”展示；落库归属由创建入口补默认项目。
      projectId: null,
      workspacePath: defaultRoot,
      additionalDirectories: [],
    });
    expect(saveProject).toHaveBeenCalledWith({ roots: [defaultRoot], name: "default" });
    // 历史无归属任务复用既有 moveTask 并入默认项目，不改 cwd。
    expect(moveTask).toHaveBeenCalledWith({
      task: { taskId: "legacy-chat", workspacePath: defaultRoot },
      projectId: defaultProject.id,
    });
    // 再次调用复用同一默认项目，不重复创建。
    await service.prepareSession();
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(moveTask).toHaveBeenCalledTimes(1);
    await expect(service.ensureDefaultProject()).resolves.toBe(defaultProject);
    // 远端草稿也不再分配 root 外目录；pending 草稿仍落在默认工作区。
    await expect(
      service.prepareSession({ draftId: "cc29167e-5a72-4c24-9e31-adcc584c73b4" }),
    ).resolves.toEqual({
      projectId: null,
      workspacePath: defaultRoot,
      additionalDirectories: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
