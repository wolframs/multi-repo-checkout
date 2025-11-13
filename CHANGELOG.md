# Change Log

All notable changes to the "multi-repo-checkout" extension will be documented in this file.

## Released

### [0.2.0]
- Feature [Delete stale local branches with date cutoff](https://github.com/wolframs/multi-repo-checkout/issues/8)
  - New command: "Multi-Repo Branch Switcher: Delete Stale Local Branches"
  - Configurable cutoff days (default: 14 days)
  - Protected branch patterns to prevent deletion of important branches
  - Dry-run mode for previewing deletions
  - Skips repositories with uncommitted changes
- Feature [Quick switch to default branch](https://github.com/wolframs/multi-repo-checkout/issues/9)
  - New command: "Multi-Repo Branch Switcher: Switch to Default Branch"
  - Fast path without enumerating all refs
  - Automatic detection of default branch from remote HEAD or common names
  - Handles remote-only branches by creating tracking branches
- Bugfix [Reload prompt appears only after pull completion](https://github.com/wolframs/multi-repo-checkout/issues/12)
  - Reload window prompt now waits for all pull operations to complete
  - Added settling delay to ensure source control is ready before prompting

### [0.1.8]
- Enhancement [Auto Pull after checkout if possible](https://github.com/wolframs/multi-repo-checkout/issues/10)
- Move functional code out of extension.ts to separate .ts files

### [0.1.7]
- Enhancement [Add screenshots / gif of functionality to README.md](https://github.com/wolframs/multi-repo-checkout/issues/3)

### [0.1.6]
- Feature [Auto reload window after successful checkouts (with settings flag)](https://github.com/wolframs/multi-repo-checkout/issues/2)
- Added configuration to configure "Registering changes..." delay

### [0.1.5]
- Bugfix [Progress indication not accurate when checking out repo branches](https://github.com/wolframs/multi-repo-checkout/issues/4)
- Added SCM Progress Indicator

### [0.1.4]
- Better repo cleanliness check

### [0.1.3]
- Bugfix: [Branch switching "successful", although working tree is dirty and repo branch does not actually get checked out](https://github.com/wolframs/multi-repo-checkout/issues/1)

### [0.1.2]
- Readme adjustments for Extension Store
  
### [0.1.1]
- Proper package, icon
- Progress indication
  
### [0.0.1]
- Initial release