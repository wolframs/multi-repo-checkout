declare module 'vscode' {
    export interface Git {
      getAPI(version: 1): GitAPI;
    }
  
    export interface GitAPI {
      repositories: Repository[];
    }
  
    export interface Repository {
      rootUri: Uri;
      state: RepositoryState;
    }
  
    export interface RepositoryState {
      refs: Ref[];
    }
  
    export interface Ref {
      type: RefType;
      name: string;
      commit: string;
      remote?: string;
    }
  
    export enum RefType {
      Head = 0,
      RemoteHead = 1,
      Tag = 2
    }
  }