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
    let loaded = 0;
    return cache.collect(repos, {
        ...options,
        onRepositoryLoaded: (repoName, fromCache) => {
            loaded++;
            progress.report({
                message: `${fromCache ? "Loaded" : "Collected"} ${repoName} (${loaded}/${repos.length})`,
                increment,
            });
        },
    });
}
