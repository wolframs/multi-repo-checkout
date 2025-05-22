import * as vscode from "vscode";
import { ApiRepository } from "./types";

export async function autoPull(repos: ApiRepository[]) {    const pullPromises = repos.map(async (repo) => {
        const path = repo.root;
        const name = path.split("/").pop();
        const gitExtension =
            vscode.extensions.getExtension("vscode.git")?.exports;
        if (!gitExtension) {
            console.error("Git extension not found");
            return;
        }
        const api = gitExtension.getAPI(1);
        const repository = api.repositories.find(
            (r: { rootUri: { fsPath: string; }; }) => r.rootUri.fsPath === path
        );
        if (!repository) {
            console.error(`Repository not found: ${name}`);
            return;
        }
        await repository.pull();
    });

    await Promise.all(pullPromises);
}
