import * as path from "path";
import { repositoryCacheKey } from "./branch-cache";
import { mapWithConcurrency } from "./concurrency";
import {
    getConfigDefaultBranch,
    getConfigMaxConcurrentRepositories,
} from "./config";
import { branchExists, checkoutBranch } from "./git-commands";
import { repositoryPath } from "./git-api";
import { isRepoClean } from "./is-repo-clean";
import { ApiRepository, BranchCatalog, BranchSnapshot } from "./types";

export type SwitchReason =
    | "selected-local"
    | "selected-remote"
    | "created"
    | "fallback";

export interface RepositorySwitchPlan {
    repository: ApiRepository;
    repositoryName: string;
    repositoryPath: string;
    requestedBranch: string;
    targetBranch?: string;
    source?: "local" | "remote" | "new";
    reason?: SwitchReason;
    blocked?: "unsafe" | "missing";
    blockedMessage?: string;
}

export async function createRepositorySwitchPlans(
    repositories: ApiRepository[],
    branchName: string,
    createNewBranch: boolean,
    catalog?: BranchCatalog,
    onComplete?: (completed: number, total: number) => void
): Promise<RepositorySwitchPlan[]> {
    let completed = 0;
    return mapWithConcurrency(
        repositories,
        getConfigMaxConcurrentRepositories(),
        async (repository) => {
            const plan = await createRepositorySwitchPlan(
                repository,
                branchName,
                createNewBranch,
                catalog
            );
            onComplete?.(++completed, repositories.length);
            return plan;
        }
    );
}

export async function executeRepositorySwitchPlans(
    plans: RepositorySwitchPlan[],
    catalog?: BranchCatalog,
    revalidateSafety = false,
    onComplete?: (completed: number, total: number) => void
): Promise<string[]> {
    let completed = 0;
    return mapWithConcurrency(
        plans,
        getConfigMaxConcurrentRepositories(),
        async (plan) => {
            const result = await executeRepositorySwitchPlan(
                plan,
                catalog,
                revalidateSafety
            );
            onComplete?.(++completed, plans.length);
            return result;
        }
    );
}

async function createRepositorySwitchPlan(
    repository: ApiRepository,
    branchName: string,
    createNewBranch: boolean,
    catalog?: BranchCatalog
): Promise<RepositorySwitchPlan> {
    const repoPath = repositoryPath(repository);
    const repositoryName = path.basename(repoPath);
    const base = {
        repository,
        repositoryName,
        repositoryPath: repoPath,
        requestedBranch: branchName,
    };

    try {
        if (!(await isRepoClean(repoPath))) {
            return {
                ...base,
                blocked: "unsafe",
                blockedMessage: "Uncommitted changes, unpushed commits, or no upstream",
            };
        }

        const snapshot = catalog?.byRepository.get(repositoryCacheKey(repoPath));
        const selected = await getAvailability(repoPath, branchName, snapshot);
        if (selected.local) {
            return {
                ...base,
                targetBranch: branchName,
                source: "local",
                reason: "selected-local",
            };
        }
        if (selected.remote) {
            return {
                ...base,
                targetBranch: branchName,
                source: "remote",
                reason: "selected-remote",
            };
        }
        if (createNewBranch) {
            return {
                ...base,
                targetBranch: branchName,
                source: "new",
                reason: "created",
            };
        }

        const fallbackBranch = getConfigDefaultBranch();
        const fallback = await getAvailability(repoPath, fallbackBranch, snapshot);
        if (fallback.local || fallback.remote) {
            return {
                ...base,
                targetBranch: fallbackBranch,
                source: fallback.local ? "local" : "remote",
                reason: "fallback",
            };
        }
        return {
            ...base,
            blocked: "missing",
            blockedMessage: `Neither ${branchName} nor fallback ${fallbackBranch} exists`,
        };
    } catch (error) {
        return {
            ...base,
            blocked: "missing",
            blockedMessage: error instanceof Error ? error.message : String(error),
        };
    }
}

async function executeRepositorySwitchPlan(
    plan: RepositorySwitchPlan,
    catalog?: BranchCatalog,
    revalidateSafety = false
): Promise<string> {
    if (plan.blocked) {
        const icon = plan.blocked === "unsafe" ? "⚠️" : "❌";
        return `${icon} ${plan.repositoryName}: ${plan.blockedMessage} – skipped`;
    }

    try {
        if (revalidateSafety && !(await isRepoClean(plan.repositoryPath))) {
            return `⚠️ ${plan.repositoryName}: Repository changed after preflight – skipped`;
        }
        await checkoutBranch(plan.repositoryPath, plan.targetBranch!, plan.source!);
        const snapshot = catalog?.byRepository.get(
            repositoryCacheKey(plan.repositoryPath)
        );
        snapshot?.local.add(plan.targetBranch!);
        return successMessage(plan);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `❌ ${plan.repositoryName}: ${message}`;
    }
}

async function getAvailability(
    repoPath: string,
    branch: string,
    snapshot?: BranchSnapshot
): Promise<{ local: boolean; remote: boolean }> {
    if (snapshot) {
        const local = snapshot.local.has(branch)
            || await branchExists(repoPath, branch, "local");
        if (local) {
            snapshot.local.add(branch);
            return { local: true, remote: snapshot.remote.has(branch) };
        }
        const remote = snapshot.remote.has(branch)
            || await branchExists(repoPath, branch, "remote");
        if (remote) {
            snapshot.remote.add(branch);
        }
        return { local: false, remote };
    }
    const [local, remote] = await Promise.all([
        branchExists(repoPath, branch, "local"),
        branchExists(repoPath, branch, "remote"),
    ]);
    return { local, remote };
}

function successMessage(plan: RepositorySwitchPlan): string {
    switch (plan.reason) {
        case "selected-local":
            return `✅ ${plan.repositoryName}: Switched to existing local branch`;
        case "selected-remote":
            return `✅ ${plan.repositoryName}: Created local tracking branch from origin`;
        case "created":
            return `✅ ${plan.repositoryName}: Created new local branch`;
        case "fallback":
            return `✅ ${plan.repositoryName}: Switched to ${plan.targetBranch} branch`;
    }
    return `✅ ${plan.repositoryName}: Switched branches`;
}
