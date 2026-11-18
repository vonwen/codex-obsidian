import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VaultService } from "../lib/vault.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-obsidian-test-"));
  await mkdir(path.join(root, "工具", "Codex"), { recursive: true });
  await writeFile(path.join(root, "首页.md"), "# 首页\n\n[[工具/Codex/远程开发]]\n", "utf8");
  await writeFile(path.join(root, "工具", "Codex", "远程开发.md"), "# 远程开发\n\nSSH 配置。\n", "utf8");
  return { root, vault: await new VaultService(root).initialize() };
}

test("lists nested Markdown notes and renders wiki links", async (t) => {
  const { root, vault } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const listed = await vault.listTree();
  assert.equal(listed.noteCount, 2);
  const note = await vault.readNote("首页.md");
  assert.match(note.html, /#vault-note=/);
});

test("searches paths and content", async (t) => {
  const { root, vault } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const byPath = await vault.searchNotes("远程开发");
  assert.equal(byPath.matches[0].path, "工具/Codex/远程开发.md");
  const byContent = await vault.searchNotes("SSH");
  assert.equal(byContent.matches.length, 1);
});

test("blocks traversal and non-Markdown files", async (t) => {
  const { root, vault } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => vault.readNote("../outside.md"), /cannot leave/);
  await assert.rejects(() => vault.readNote("image.png"), /Only Markdown/);
});

test("saves atomically and detects concurrent edits", async (t) => {
  const { root, vault } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const opened = await vault.readNote("首页.md");
  const saved = await vault.saveNote("首页.md", "# 已更新\n", opened.mtimeMs);
  assert.equal(saved.content, "# 已更新\n");
  await writeFile(path.join(root, "首页.md"), "# 外部修改\n", "utf8");
  await assert.rejects(() => vault.saveNote("首页.md", "# 覆盖\n", saved.mtimeMs), /changed after/);
  assert.equal(await readFile(path.join(root, "首页.md"), "utf8"), "# 外部修改\n");
});

test("creates notes only inside existing vault directories", async (t) => {
  const { root, vault } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const note = await vault.createNote("工具/新笔记.md", "# 新笔记\n");
  assert.equal(note.path, "工具/新笔记.md");
  await assert.rejects(() => vault.createNote("不存在/新笔记.md", ""));
});
