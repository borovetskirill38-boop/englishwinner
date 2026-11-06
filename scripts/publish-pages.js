/* Publish only committed website files to gh-pages; no checkout or API calls. */
"use strict";
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function publish(repository = path.resolve(__dirname, ".."), remote = "origin") {
  function git(args, input) {
    return execFileSync("git", args, { cwd: repository, encoding: "utf8", input,
      stdio: ["pipe", "pipe", "pipe"] }).trimEnd();
  }
  git(["diff", "--quiet", "HEAD"]);
  const source = git(["rev-parse", "--verify", "HEAD^{commit}"]);
  // The complete offline dictionary can exceed Node's default 1 MiB buffer.
  const file = (name) => execFileSync("git", ["show", `HEAD:${name}`], {
    cwd: repository, maxBuffer: 16 * 1024 * 1024,
  });
  let previous = null;
  let exists = false;
  try {
    git(["ls-remote", "--exit-code", remote, "refs/heads/gh-pages"]);
    exists = true;
  } catch (error) {
    // Exit 2 is Git's successful query with no matching branch. Access errors
    // must not be mistaken for an absent branch.
    if (error.status !== 2) throw error;
  }
  if (exists) {
    git(["fetch", "--no-tags", remote, "refs/heads/gh-pages"]);
    previous = git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
  }
  function blob(contents) { return git(["hash-object", "-w", "--stdin"], contents); }
  function tree(entries) {
    return git(["mktree"], entries.map(([type, hash, name]) =>
      `${type === "tree" ? "040000" : "100644"} ${type} ${hash}\t${name}\n`).join(""));
  }
  const licenses = tree([["blob", blob(file("licenses/CC-BY-SA-4.0.txt")), "CC-BY-SA-4.0.txt"]]);
  const website = tree([
    ["blob", blob(file("index.html")), "index.html"],
    ["blob", blob(Buffer.alloc(0)), ".nojekyll"],
    ["blob", blob(file("LICENSE")), "LICENSE"],
    ["tree", licenses, "licenses"],
    ["blob", blob(`English Winner website\n\nBuilt from source commit ${source}.\n`), "README.md"],
  ]);
  if (previous && git(["rev-parse", `${previous}^{tree}`]) === website) {
    return { commit: previous, source, changed: false };
  }
  const args = ["commit-tree", website];
  if (previous) args.push("-p", previous);
  args.push("-m", `Publish English Winner from ${source.slice(0, 7)}`);
  const commit = git(args);
  git(["push", `--force-with-lease=refs/heads/gh-pages:${previous || ""}`,
    remote, `${commit}:refs/heads/gh-pages`]);
  return { commit, source, changed: true };
}

if (require.main === module) {
  try { console.log(JSON.stringify(publish())); }
  catch (error) {
    console.error(error.stderr ? String(error.stderr).trim() : error.message);
    process.exitCode = 1;
  }
}
module.exports = { publish };
