# Changelog

All notable changes to PackLens are documented here.

## [0.0.2] : 2026-11-24

### Added

: Extension icon

### Fixed

: Duplicates view listed only the first duplicated package

: Unused and outdated checks now use declared dependencies, not everything in node_modules, after a deep scan

: Dependency ranges like >=1.0.0, 1.x and prereleases are parsed correctly, and workspace, git, file and npm alias specs are skipped

: Outdated check queries the registry once per package, in parallel

: Deep scan follows symlinked packages and survives unreadable folders

: Status bar no longer stays on Scanning when a scan fails

: Saved templates load when the panel opens

: Add to Current Project button now appears on installed packages in the tree

: Installer links scoped packages and keeps package.json line endings, indentation and trailing newline

: Webview buttons work with Windows paths and names containing quotes, and all displayed data is escaped

: Package detail page escapes package fields and uses a content security policy

: Hover shows the real latest version and no longer trusts registry text

: Icon library is bundled instead of loaded from unpkg

: Lint config and npm test run again

## [0.0.1] : 2026-04-27

### Added

: Projects panel showing all npm projects across watched folders with package count, node_modules size, and last modified date

: Deep scan that walks node_modules and returns real disk sizes per package and per project

: Quick scan that reads package.json only, instant results with no disk walking

: Duplicate detection across all projects showing wasted space per package

: All Packages tab with search, sort by name, size, or most used, and one-click add to current project

: Install from local projects using symlinks first, copy fallback, npm fallback with explicit user confirmation before any download

: Outdated packages checker against npm registry showing current vs latest version per project

: Unused package detection by scanning source files for imports and flagging packages never referenced

: Project templates — save any project's packages as a reusable template and apply to new projects

: Hover provider for package.json showing version, description, deprecation warnings, publish date, and npm link

: Status bar item showing total node_modules size across all projects

: First launch notification showing total wasted space from duplicates

: Native folder picker for adding watched folders, no typing required

: Delete node_modules per project with confirmation dialog, user controlled

: Overview tab with stats cards, recent projects, and top duplicates at a glance

: Full webview panel with Overview, Projects, All Packages, Duplicates, Outdated, Unused, and Templates tabs

: PackLens icon in the activity bar