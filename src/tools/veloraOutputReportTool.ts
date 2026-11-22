import fs from "node:fs";
import path from "node:path";

const DEFAULT_VELORA_ROOT = "/home/hossein/Desktop/projects/building-management";

function resolveCanonicalOutputRoot(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): { projectRoot: string; outputRoot: string } {
  const candidate = String(
    input.projectRoot ?? configuration.projectRoot ?? configuration.workspaceRoot ?? DEFAULT_VELORA_ROOT,
  ).trim();
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error("velora_output_report_tool requires an absolute projectRoot.");
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`velora_output_report_tool projectRoot "${candidate}" does not exist or is not a directory.`);
  }
  const projectRoot = fs.realpathSync(candidate);
  const rawOutputDir = path.join(projectRoot, "output");
  if (!fs.existsSync(rawOutputDir)) {
    fs.mkdirSync(rawOutputDir, { recursive: true });
  }
  const lst = fs.lstatSync(rawOutputDir);
  if (lst.isSymbolicLink() || !lst.isDirectory()) {
    throw new Error(`Output directory "${rawOutputDir}" must be a real directory, not a symlink.`);
  }
  return { projectRoot, outputRoot: fs.realpathSync(rawOutputDir) };
}

function resolveSafeOutputTarget(outputRoot: string, rawRelativePath: unknown): { relativePath: string; targetPath: string } {
  if (typeof rawRelativePath !== "string") {
    throw new Error("Invalid output report relativePath: must be a non-empty string.");
  }
  if (rawRelativePath.includes("\0")) {
    throw new Error("Invalid output report relativePath: null bytes are forbidden.");
  }
  const trimmed = rawRelativePath.trim();
  if (!trimmed) {
    throw new Error("Invalid output report relativePath: path cannot be empty.");
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error(`Output report relativePath "${trimmed}" cannot be an absolute path; writes must stay inside output/.`);
  }

  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((seg) => seg === "." || seg === "..")) {
    throw new Error(`Output report path "${trimmed}" contains parent traversal (".."), which is outside output/ boundary.`);
  }

  // Strip an optional leading "output/" prefix only when there are remaining segments.
  const normalizedSegments = segments[0] === "output" && segments.length > 1 ? segments.slice(1) : segments;

  // Walk every prefix from outputRoot and reject any symbolic link along the chain.
  let current = outputRoot;
  for (const seg of normalizedSegments) {
    current = path.join(current, seg);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(current);
    } catch {
      stat = undefined;
    }
    if (stat?.isSymbolicLink()) {
      throw new Error(`Output report path "${trimmed}" traverses a symlink at "${current}", which is forbidden.`);
    }
  }

  const targetPath = path.resolve(outputRoot, ...normalizedSegments);
  const rel = path.relative(outputRoot, targetPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Output report path "${trimmed}" escapes the output/ directory boundary.`);
  }

  return { relativePath: normalizedSegments.join("/"), targetPath };
}

export function executeVeloraOutputReportTool(
  configuration: Record<string, string | number | boolean>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { projectRoot, outputRoot } = resolveCanonicalOutputRoot(configuration, input);
  const action = String(
    input.action ??
      configuration.action ??
      (input.content !== undefined ? "write" : input.relativePath !== undefined || input.path !== undefined ? "read" : "list"),
  )
    .trim()
    .toLowerCase();

  if (action === "write") {
    const { relativePath, targetPath } = resolveSafeOutputTarget(outputRoot, input.relativePath ?? input.path);
    const parentDir = path.dirname(targetPath);
    fs.mkdirSync(parentDir, { recursive: true });
    const realParent = fs.realpathSync(parentDir);
    const parentRel = path.relative(outputRoot, realParent);
    if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) {
      throw new Error(`Output report parent directory "${realParent}" escapes output/ boundary.`);
    }

    const content =
      typeof input.content === "string" ? input.content : JSON.stringify(input.content ?? "", null, 2);
    fs.writeFileSync(targetPath, content, "utf8");
    return {
      ok: true,
      action: "write",
      projectRoot,
      outputRoot,
      relativePath,
      path: targetPath,
      bytesWritten: Buffer.byteLength(content, "utf8"),
    };
  }

  if (action === "read") {
    const { relativePath, targetPath } = resolveSafeOutputTarget(outputRoot, input.relativePath ?? input.path);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      throw new Error(`Output report file "${relativePath}" does not exist under "${outputRoot}".`);
    }
    const content = fs.readFileSync(targetPath, "utf8");
    return {
      ok: true,
      action: "read",
      projectRoot,
      outputRoot,
      relativePath,
      path: targetPath,
      content,
    };
  }

  if (action === "list") {
    const subDirRaw = input.relativePath ?? input.path;
    const dirToRead =
      typeof subDirRaw === "string" && subDirRaw.trim()
        ? resolveSafeOutputTarget(outputRoot, subDirRaw).targetPath
        : outputRoot;
    const entries =
      fs.existsSync(dirToRead) && fs.statSync(dirToRead).isDirectory()
        ? fs.readdirSync(dirToRead).sort()
        : [];
    return {
      ok: true,
      action: "list",
      projectRoot,
      outputRoot,
      path: dirToRead,
      entries,
    };
  }

  throw new Error(`Unsupported velora_output_report_tool action "${action}". Expected write, read, or list.`);
}
