// PreToolUse hook: lets Claude Code run read-only git commands only (AGENTS.md → rule 1).
// Allowlist, not blocklist: any git subcommand not listed below is blocked, including ones git adds later.
// Checks every git call in the command, including chained (`&&`, `;`, `|`) and `git -C <dir> …` forms.
// Exit code 2 blocks the tool call and shows the message to the agent.

const READ_ONLY = new Set([
  "status", "log", "diff", "show", "blame", "shortlog", "describe", "grep", "ls-files", "ls-tree", "cat-file",
  "rev-parse", "rev-list", "merge-base", "name-rev", "for-each-ref", "show-ref", "count-objects", "whatchanged",
  "help", "version",
])

// `git branch` lists with these flags only; a bare name creates a branch unless one of the filters is given.
const BRANCH_LIST_FLAG = /^(-a|--all|-r|--remotes|-l|--list|-v|-vv|--verbose|--show-current|--contains|--merged|--no-merged|--sort=.*|--format=.*)$/
const BRANCH_FILTER = /^(-l|--list|--contains|--merged|--no-merged)$/
const BRANCH_CHANGE_FLAG = /^(-d|-D|--delete|-m|-M|--move|-c|-C|--copy|-f|--force|-u|--set-upstream-to.*|--unset-upstream|--edit-description)$/

// Subcommands that only read with these arguments, and change the repository with any other ones.
const READ_ONLY_WITH = {
  branch: (args) =>
    args.every((a) => BRANCH_LIST_FLAG.test(a)) ||
    (args.some((a) => BRANCH_FILTER.test(a)) && !args.some((a) => BRANCH_CHANGE_FLAG.test(a))),
  tag: (args) => args.length === 0 || args.some((a) => a === "-l" || a === "--list"),
  remote: (args) => args.length === 0 || ["-v", "--verbose", "show", "get-url"].includes(args[0]),
  stash: (args) => ["list", "show"].includes(args[0]),
  reflog: (args) => args.length === 0 || args[0] === "show" || args[0].startsWith("-"),
  worktree: (args) => args[0] === "list",
  config: (args) => args.some((a) => /^(--get|--get-all|--get-regexp|-l|--list)$/.test(a)),
}

// Global options that take a separate value: `git -C <dir> log`, `git -c key=value log`.
const OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"])

// Words that run the command after them: `sudo git push`, `env X=1 git push`, `xargs git rm`.
const PREFIXES = new Set(["sudo", "env", "command", "exec", "time", "nice", "nohup", "xargs", "&", "!"])

function blockedGitCall(command) {
  // Split into simple commands, also at quotes so `bash -c "git push"` and `powershell -Command 'git push'` are seen.
  // Escaped spaces (C:/Program\ Files/Git/bin/git.exe) stay inside one token.
  for (const part of command.replace(/\\ /g, "\u0000").split(/&&|\|\||[;|\n"'`()]|\$\(/)) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    let start = 0
    while (start < tokens.length && (PREFIXES.has(tokens[start]) || /^\w+=/.test(tokens[start]))) start++
    // Only a command that *is* git counts, so `grep -rn git src` or `echo git` don't.
    if (!/(^|[\\/])git(\.exe)?$/i.test(tokens[start] ?? "")) continue

    let i = start + 1
    while (i < tokens.length && tokens[i].startsWith("-")) {
      i += OPTIONS_WITH_VALUE.has(tokens[i]) ? 2 : 1
    }
    const sub = tokens[i]
    const args = tokens.slice(i + 1)
    if (sub === undefined) continue // bare `git` / `git --version`
    if (READ_ONLY.has(sub)) continue
    if (READ_ONLY_WITH[sub]?.(args)) continue
    return `git ${[sub, ...args].join(" ")}`.trim()
  }
  return null
}

let input = ""
process.stdin.on("data", (chunk) => (input += chunk))
process.stdin.on("end", () => {
  const command = JSON.parse(input || "{}").tool_input?.command ?? ""
  const blocked = blockedGitCall(command)
  if (blocked) {
    process.stderr.write(
      `Blocked: "${blocked}" can change the repository. Git is read-only in this project (AGENTS.md, rule 1): ` +
        "use status/log/diff/show/blame and similar, and leave changes uncommitted for the user.\n",
    )
    process.exit(2)
  }
})
