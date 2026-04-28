# PackLens

[![Version](https://img.shields.io/visual-studio-marketplace/v/firekid.packlens-x?style=flat-square&color=0078d4&label=version&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=firekid.packlens-x)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/firekid.packlens-x?style=flat-square&color=22c55e&label=installs)](https://marketplace.visualstudio.com/items?itemName=firekid.packlens-x)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/firekid.packlens-x?style=flat-square&color=f59e0b&label=rating)](https://marketplace.visualstudio.com/items?itemName=firekid.packlens-x)
[![License: MIT](https://img.shields.io/badge/license-MIT-8b5cf6?style=flat-square)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.109%2B-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![GitHub stars](https://img.shields.io/github/stars/Firekid-is-him/packlens?style=flat-square&color=f59e0b&logo=github)](https://github.com/Firekid-is-him/packlens/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/Firekid-is-him/packlens?style=flat-square&color=ef4444&logo=github)](https://github.com/Firekid-is-him/packlens/issues)

Visual npm package manager for VS Code. See every package across all your projects in one place, find duplicates, detect unused packages, and install from your local cache instead of downloading again.

---

## The Problem

Every project gets its own `node_modules`. You end up with the same packages downloaded 10, 20, 30 times across your machine. No tool tells you how bad it is, until now.

PackLens scans your projects, shows you the real numbers, and lets you install packages from projects you already have locally. No internet. No waiting.

---

## Features

### Projects Overview
See all your npm projects in one panel. Package count, real node_modules size after a deep scan, last modified date. Everything at a glance without opening each project.

### Duplicate Detection
PackLens finds packages installed across multiple projects and shows you exactly how much space is being wasted. The first time it runs, it shows you the total as a notification, most devs are surprised by the number.

### Install From Local Projects
When you need a package in a new project, PackLens checks if you already have it somewhere on your machine first. If yes, it symlinks it directly, zero download, instant. Falls back to copy if symlinks aren't available, and only asks to use npm if the package genuinely doesn't exist locally.

### All Packages View
Every package across every project in one searchable list. Sort by name, size, or how many projects use it. Add any package to your current project with one click.

### Outdated Packages
Check the npm registry for newer versions across all your projects at once. See current vs latest in one view instead of running `npm outdated` in every folder.

### Unused Package Detection
PackLens scans your source files and finds packages installed but never imported. No regex tricks, it actually walks your `.ts`, `.tsx`, `.js`, `.jsx` files and checks.

### Package.json Hover
Hover any package name in `package.json` and get version, description, deprecation status, publish date, and a link to npm inline in the editor.

### Project Templates
Save any project's package set as a template. New project? Pick a template and install everything from your local cache in seconds.

---

## Getting Started

**1.** Install PackLens from the VS Code Marketplace

**2.** Click the PackLens icon in the activity bar

**3.** Click the `+` button and pick your projects folder: Desktop, Documents, Downloads, wherever you keep your work

**4.** PackLens scans automatically and shows your projects

**5.** Click the status bar item or the layout icon to open the full panel

---

## Scans

| Scan | What it does | Speed |
|:--|:--|:--|
| Quick Scan | Reads package.json only | Instant |
| Deep Scan | Walks node_modules, real sizes | Slower, more accurate |

Run Quick Scan first to see your projects. Run Deep Scan when you want real disk sizes and wasted space numbers.

---

## Installing Packages

When you click **Add** on any package in the All Packages view:

: PackLens checks if the package already exists in any scanned project's node_modules

: If found, symlinks it directly to your target project. No download.

: If symlinks are unavailable on your system, copies it instead. Still no download.

: If not found anywhere locall, asks before falling back to npm install

---

## Requirements

: VS Code 1.109.0 or higher
: Node.js installed
: npm installed

---

## Extension Settings

| Setting | Default | Description |
|:--|:--|:--|
| `packlens.watchedFolders` | `[]` | Folders PackLens scans for npm projects |
| `packlens.symlinkMode` | `true` | Use symlinks when installing from cache |
| `packlens.autoScanOnStartup` | `true` | Automatically scan on VS Code startup |

---

## Roadmap

: File watcher, auto detect new projects without manual rescan
: CVE vulnerability alerts
: Bundle size warnings before install
: GitHub stars and weekly downloads in hover
: Package health score per project

---

## License

MIT — Built by [Firekid](https://github.com/Firekid-is-him)
