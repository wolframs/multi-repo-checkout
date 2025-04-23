export interface Git {
    repositories: ApiRepository[];
}

export interface ApiRepository {
    root: string;
    getRefs(opts?: { contains?: string }): Promise<Ref[]>;
    checkout(branch: string, createBranch?: boolean): Thenable<void>;
    state: {
        HEAD: Ref | undefined;
    };
}

export interface Ref {
    name: string;
    commit?: string;
    type: RefType;
    remote?: string;
}

export enum RefType {
    Head,
    RemoteHead,
    Tag,
}