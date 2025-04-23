import * as vscode from "vscode";
import { ApiRepository, Ref, RefType } from "./types";

export async function collectAllBranches(
    repos: ApiRepository[],
    progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Set<string>> {
    const allBranches = new Set<string>();
    const total = repos.length;
    let completed = 1;

    for (const repo of repos) {
        progress.report({
            message: `Collecting from ${repo.root.split("\\").pop()}...`,
            increment: (completed / total) * 100,
        });

        for (const repo of repos) {
            const refs = await repo.getRefs();
            if (!repo.getRefs) {
                vscode.window.showErrorMessage(
                    `Unable to get refs from repository ${repo.root
                        .split("\\")
                        .pop()}`
                );
            }
            refs.forEach((ref: Ref) => {
                if (ref.type === RefType.Head) {
                    allBranches.add(ref.name);
                }
                if (
                    ref.type === RefType.RemoteHead &&
                    ref.remote === "origin"
                ) {
                    allBranches.add(ref.name.substring("origin/".length));
                }
            });
        }
        completed++;
    }
    return allBranches;
}
