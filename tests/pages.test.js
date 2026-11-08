"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { publish } = require("../scripts/publish-pages.js");

test("website publication preserves large HTML files, source and Pages history and is repeatable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "englishwinner-pages-"));
  const source = path.join(dir, "source"), remote = path.join(dir, "remote.git");
  fs.mkdirSync(source);
  function git(args, cwd = source) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  }
  try {
    git(["init", "--bare", remote]);
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.invalid"]);
    git(["remote", "add", "origin", remote]);
    fs.mkdirSync(path.join(source, "licenses"));
    fs.writeFileSync(path.join(source, "index.html"), "<!doctype html><title>First</title>\n");
    fs.writeFileSync(path.join(source, "phrases.html"), "<!doctype html><title>Expressions</title>\n");
    fs.writeFileSync(path.join(source, "LICENSE"), "Application license\n");
    fs.writeFileSync(path.join(source, "licenses/CC-BY-SA-4.0.txt"), "Vocabulary license\n");
    git(["add", "."]); git(["commit", "-m", "First website"]);
    const head = git(["rev-parse", "HEAD"]);
    const first = publish(source);
    assert.equal(first.source, head);
    assert.equal(first.changed, true);
    assert.equal(git(["show", "gh-pages:index.html"], remote), "<!doctype html><title>First</title>");
    assert.equal(git(["show", "gh-pages:phrases.html"], remote), "<!doctype html><title>Expressions</title>");
    assert.equal(git(["show", "gh-pages:.nojekyll"], remote), "");
    assert.equal(git(["show", "gh-pages:licenses/CC-BY-SA-4.0.txt"], remote), "Vocabulary license");
    assert.equal(git(["branch", "--show-current"]), "main");
    assert.equal(git(["rev-parse", "HEAD"]), head);
    assert.equal(git(["status", "--porcelain"]), "");
    assert.deepEqual(publish(source), { commit: first.commit, source: head, changed: false });
    const largeHTML = "<!doctype html><title>Updated</title>\n<!--" + "word ".repeat(250000) + "-->\n";
    assert.ok(Buffer.byteLength(largeHTML) > 1024 * 1024);
    fs.writeFileSync(path.join(source, "index.html"), largeHTML);
    fs.writeFileSync(path.join(source, "phrases.html"), "<!doctype html><title>Updated expressions</title>\n");
    assert.throws(() => publish(source));
    git(["add", "."]); git(["commit", "-m", "Update website"]);
    const second = publish(source);
    assert.notEqual(second.commit, first.commit);
    git(["merge-base", "--is-ancestor", first.commit, second.commit], remote);
    assert.equal(git(["rev-parse", "gh-pages:index.html"], remote), git(["rev-parse", "HEAD:index.html"]));
    assert.equal(git(["show", "gh-pages:phrases.html"], remote), "<!doctype html><title>Updated expressions</title>");
    assert.equal(git(["status", "--porcelain"]), "");
    assert.deepEqual(publish(source), { commit: second.commit, source: second.source, changed: false });
    git(["remote", "set-url", "origin", path.join(dir, "missing-remote")]);
    assert.throws(() => publish(source));
    assert.equal(git(["rev-parse", "gh-pages"], remote), second.commit);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
