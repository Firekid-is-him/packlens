# Changelog

All notable changes to PackLens are documented here.

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