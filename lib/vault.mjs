import { promises as fs } from "node:fs";
import path from "node:path";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".obsidian",
  ".claudian",
  ".trash",
  "node_modules",
]);

export class VaultService {
  constructor(root, { ignores = DEFAULT_IGNORES } = {}) {
    this.root = path.resolve(root);
    this.ignores = ignores;
  }

  async initialize() {
    const stat = await fs.stat(this.root);
    if (!stat.isDirectory()) throw new Error(`Vault is not a directory: ${this.root}`);
    this.realRoot = await fs.realpath(this.root);
    return this;
  }

  normalizeRelative(input) {
    if (typeof input !== "string") throw new Error("Note path must be a string.");
    const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!normalized || path.posix.isAbsolute(normalized)) throw new Error("Note path must be relative to the vault.");
    const clean = path.posix.normalize(normalized);
    if (clean === ".." || clean.startsWith("../") || clean.includes("/../")) {
      throw new Error("Note path cannot leave the vault.");
    }
    if (!clean.toLowerCase().endsWith(".md")) throw new Error("Only Markdown (.md) notes are supported.");
    return clean;
  }

  async resolveNote(input, { allowMissing = false } = {}) {
    const relative = this.normalizeRelative(input);
    const absolute = path.resolve(this.realRoot, relative);
    const rootPrefix = `${this.realRoot}${path.sep}`;
    if (!absolute.startsWith(rootPrefix)) throw new Error("Note path cannot leave the vault.");

    if (allowMissing) {
      const parentReal = await fs.realpath(path.dirname(absolute));
      if (parentReal !== this.realRoot && !parentReal.startsWith(rootPrefix)) {
        throw new Error("Note parent directory cannot leave the vault.");
      }
      return { relative, absolute };
    }

    const real = await fs.realpath(absolute);
    if (!real.startsWith(rootPrefix)) throw new Error("Resolved note cannot leave the vault.");
    return { relative, absolute: real };
  }

  async listTree() {
    let noteCount = 0;
    const walk = async (absoluteDir, relativeDir = "") => {
      const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
      const entries = [];
      dirents.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
      });

      for (const dirent of dirents) {
        if (dirent.name.startsWith(".") || this.ignores.has(dirent.name)) continue;
        const relative = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
        const absolute = path.join(absoluteDir, dirent.name);
        if (dirent.isDirectory()) {
          const children = await walk(absolute, relative);
          if (children.length) entries.push({ type: "directory", name: dirent.name, path: relative, children });
        } else if (dirent.isFile() && dirent.name.toLowerCase().endsWith(".md")) {
          noteCount += 1;
          entries.push({ type: "note", name: dirent.name, path: relative });
        }
      }
      return entries;
    };

    const tree = await walk(this.realRoot);
    return { tree, noteCount };
  }

  renderMarkdown(markdown) {
    const withWikiLinks = markdown.replace(
      /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
      (_match, target, label) => `[${label || target}](#vault-note=${encodeURIComponent(target.trim())})`
    );
    const raw = marked.parse(withWikiLinks, { gfm: true, breaks: false });
    return sanitizeHtml(raw, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "details", "summary"]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ["href", "name", "target", "rel"],
        img: ["src", "alt", "title"],
        code: ["class"],
      },
      allowedSchemes: ["http", "https", "mailto"],
      transformTags: {
        a: sanitizeHtml.simpleTransform("a", { rel: "noreferrer" }, true),
      },
    });
  }

  async readNote(notePath) {
    const { relative, absolute } = await this.resolveNote(notePath);
    const [content, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
    return {
      path: relative,
      name: path.basename(relative),
      content,
      html: this.renderMarkdown(content),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  }

  async saveNote(notePath, content, expectedMtimeMs) {
    const { relative, absolute } = await this.resolveNote(notePath);
    const stat = await fs.stat(absolute);
    if (typeof expectedMtimeMs === "number" && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
      const error = new Error("This note changed after it was opened. Reload it before saving.");
      error.code = "EDIT_CONFLICT";
      throw error;
    }
    const temp = `${absolute}.codex-obsidian-${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(temp, content, { encoding: "utf8", mode: stat.mode });
    await fs.rename(temp, absolute);
    return this.readNote(relative);
  }

  async createNote(notePath, content = "") {
    const { relative, absolute } = await this.resolveNote(notePath, { allowMissing: true });
    try {
      await fs.writeFile(absolute, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("A note already exists at that path.");
      throw error;
    }
    return this.readNote(relative);
  }

  async searchNotes(query, limit = 80) {
    const needle = String(query ?? "").trim().toLocaleLowerCase("zh-CN");
    if (!needle) return { query: "", matches: [] };
    const { tree } = await this.listTree();
    const notePaths = [];
    const collect = (entries) => {
      for (const entry of entries) {
        if (entry.type === "directory") collect(entry.children);
        else notePaths.push(entry.path);
      }
    };
    collect(tree);

    const matches = [];
    for (const notePath of notePaths) {
      if (matches.length >= limit) break;
      const pathMatch = notePath.toLocaleLowerCase("zh-CN").includes(needle);
      const { absolute } = await this.resolveNote(notePath);
      const content = await fs.readFile(absolute, "utf8");
      const lower = content.toLocaleLowerCase("zh-CN");
      const index = lower.indexOf(needle);
      if (!pathMatch && index < 0) continue;
      const start = Math.max(0, index < 0 ? 0 : index - 70);
      const end = Math.min(content.length, index < 0 ? 140 : index + needle.length + 110);
      matches.push({
        path: notePath,
        name: path.basename(notePath),
        excerpt: content.slice(start, end).replace(/\s+/g, " ").trim(),
      });
    }
    return { query, matches };
  }
}
