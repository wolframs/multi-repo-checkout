export interface GitExtension {
    getAPI(version: 1): GitApi;
}

export interface GitApi {
    repositories: ApiRepository[];
}

export interface ApiRepository {
    rootUri: { fsPath: string };
    getRefs(query: RefQuery, cancellationToken?: { isCancellationRequested: boolean }): Promise<Ref[]>;
    fetch(options?: FetchOptions): Promise<void>;
    pull(unshallow?: boolean): Promise<void>;
    state: {
        HEAD: Ref | undefined;
        remotes: Remote[];
    };
}

export interface FetchOptions {
    remote?: string;
    ref?: string;
    all?: boolean;
    prune?: boolean;
    depth?: number;
}

export interface Remote {
    name: string;
    fetchUrl?: string;
}

export interface RefQuery {
    contains?: string;
    count?: number;
    pattern?: string | string[];
    sort?: "alphabetically" | "committerdate" | "creatordate";
}

export interface Ref {
    name?: string;
    commit?: string;
    type: RefType;
    remote?: string;
}

export enum RefType {
    Head,
    RemoteHead,
    Tag,
}

export interface BranchSnapshot {
    local: Set<string>;
    remote: Set<string>;
}

export interface BranchCatalog {
    branches: Set<string>;
    byRepository: Map<string, BranchSnapshot>;
    repositoryNames: Map<string, string>;
    repositoryRevision: Map<string, number>;
    staleRepositories: string[];
    remoteRefreshFailures: RepositoryFailure[];
}

export interface RepositoryFailure {
    repository: string;
    message: string;
}

export type RemoteRefreshPolicy = "Never" | "When Cache Expires" | "Always";
