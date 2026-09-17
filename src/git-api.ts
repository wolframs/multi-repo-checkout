import * as vscode from "vscode";
import { errorMessage } from "./git-commands";
import { ApiRepository, GitExtension } from "./types";

export async function getGitRepositories(
    onFailure: (reason: string) => void = (reason) => {
        vscode.window.showErrorMessage(reason);
    }
): Promise<ApiRepository[] | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
        onFailure("Unable to load Git extension");
        return undefined;
    }

    try {
        const exports = extension.isActive
            ? extension.exports
            : await extension.activate();
        return exports.getAPI(1).repositories;
    } catch (error) {
        onFailure(`Could not retrieve Git API: ${errorMessage(error)}`);
        return undefined;
    }
}

export function repositoryPath(repository: ApiRepository): string {
    return repository.rootUri.fsPath;
}
