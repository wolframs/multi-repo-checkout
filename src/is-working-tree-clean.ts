import { exec } from "child_process";

export async function isWorkingTreeClean(repoPath: string): Promise<boolean> {
    // exit-code 0 ⇒ clean, 1 ⇒ changes present
    return new Promise((resolve, reject) => {
        exec("git diff-index --quiet HEAD --", { cwd: repoPath }, (error) => {
            if (!error) {
                resolve(true); // clean
            } else if (error.code === 1) {
                resolve(false); // dirty
            } else {
                reject(new Error(`Status check failed: ${error.message}`));
            }
        });
    });
}