import { ApiRepository, RemoteRefreshPolicy } from "./types";

export type RemoteRefresher = (repository: ApiRepository) => Promise<void>;

export function createRemoteRefresher(
    policy: RemoteRefreshPolicy
): RemoteRefresher | undefined {
    if (policy === "Never") {
        return undefined;
    }

    return async (repository) => {
        if (!repository.state.remotes.some((remote) => remote.name === "origin")) {
            return;
        }
        await repository.fetch({ remote: "origin" });
    };
}
