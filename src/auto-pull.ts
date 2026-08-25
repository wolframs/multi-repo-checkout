import { ApiRepository } from "./types";
import { mapWithConcurrency } from "./concurrency";
import { getConfigMaxConcurrentRepositories } from "./config";

export async function autoPull(repos: ApiRepository[]): Promise<void> {
    await mapWithConcurrency(
        repos,
        getConfigMaxConcurrentRepositories(),
        (repo) => repo.pull()
    );
}
