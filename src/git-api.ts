import * as vscode from "vscode";
import { ApiRepository, GitExtension } from "./types";

export async function getGitRepositories(): Promise<ApiRepository[] | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
        vscode.window.showErrorMessage("Unable to load Git extension");
        return undefined;
    }

    try {
        const exports = extension.isActive
            ? extension.exports
            : await extension.activate();
        return exports.getAPI(1).repositories;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Could not retrieve Git API: ${message}`);
        return undefined;
    }
}

export function repositoryPath(repository: ApiRepository): string {
    return repository.rootUri.fsPath;
}
