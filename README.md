# Multi-Repo Branch Switcher

This VS Code extension allows you to quickly switch or create branches across all repositories in a multi-repo workspace.

## Features

- **Branch Switching**: Select any existing branch to check out simultaneously across all repositories.
- **Branch Creation**: Create a new branch in every repository at once.
- **Fallback to Default Branch**: If a local/remote branch doesn't exist and you don’t opt to create it, the extension checks out the user-defined default branch in that repository.
- **Configurable Default Branch**: Define your preferred default branch name (e.g. `main` or `master`) in VS Code settings.

## Manual Build & Installation

1. Clone or download this extension’s source code.
2. Open the folder in VS Code.
3. Run `npm install && npm run compile` (or use the VS Code debugger “Launch Extension”).
4. A new Extension Development Host window will appear, where you can test or install it.

## Usage

1. Press <kbd>Ctrl+Shift+P</kbd> (Windows/Linux) or <kbd>Cmd+Shift+P</kbd> (macOS) to open the Command Palette.
2. Run **Multi-Repo Branch Switcher: Switch Branches**.
3. Choose an existing branch from the list or select **Create New Branches for All Repos** to define a new branch name.
4. The extension will:
   - Check out the branch if it already exists locally.
   - Check out a remote-tracking branch if it exists on `origin`.
   - Prompt to create a new branch if neither is found.
   - Otherwise, it will fall back to the configured default branch.

## Configuration

Open your VS Code settings (`Settings → Extensions → Multi Repo Branch Switcher` or in `settings.json`) and set:
```json
{
  "multiRepoBranchSwitcher.defaultBranchName": "main"
}
```
By default, this is `"master"`, but you can override it based on your workflow.

## Feedback & Contributing

Feel free to open an issue or pull request on the repository if you encounter a problem or have a suggestion.

Happy coding!