import * as vscode from "vscode";
import { BranchCache, CacheOptions } from "./branch-cache";
import { ApiRepository, BranchCatalog } from "./types";

export async function collectAllBranches(
    repos: ApiRepository[],
    cache: BranchCache,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    options: Omit<CacheOptions, "onRepositoryLoaded">
): Promise<BranchCatalog> {
    const increment = repos.length === 0 ? 100 : 100 / repos.length;
    return cache.collect(repos, {
        ...options,
        onRepositoryLoaded: (repoName, fromCache) => {
            progress.report({
                message: `${fromCache ? "Loaded" : "Collected"} ${repoName}`,
                increment,
            });
        },
    });
}
