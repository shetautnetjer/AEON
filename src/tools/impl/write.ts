import { promises as fs } from "node:fs";
import * as path from "node:path";
import { withMemoryEditLease } from "@/agent/memory-edit-lease";
import { getCurrentWorkingDirectory } from "@/runtime-context";
import { expandFilePath } from "@/utils/file-path";
import { writeUtf8Text } from "@/utils/text-files";
import { validateRequiredParams } from "./validation.js";

interface WriteArgs {
  file_path: string;
  content: string;
}
interface WriteResult {
  message: string;
}

/** Write a file; inside the agent's memory checkout, under the memory lease. */
export async function write(args: WriteArgs): Promise<WriteResult> {
  if (typeof args?.file_path !== "string") return writeUnlocked(args);
  const resolvedPath = expandFilePath(
    args.file_path,
    getCurrentWorkingDirectory(),
  );
  return withMemoryEditLease(resolvedPath, () => writeUnlocked(args));
}

async function writeUnlocked(args: WriteArgs): Promise<WriteResult> {
  validateRequiredParams(args, ["file_path", "content"], "Write");
  const { file_path, content } = args;
  const userCwd = getCurrentWorkingDirectory();
  const resolvedPath = expandFilePath(file_path, userCwd);
  try {
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });
    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.isDirectory())
        throw new Error(`Path is a directory, not a file: ${resolvedPath}`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw err;
    }
    await writeUtf8Text(resolvedPath, content);
    return {
      message: `Successfully wrote ${content.length} characters to ${resolvedPath}`,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EACCES")
      throw new Error(`Permission denied: ${resolvedPath}`);
    else if (err.code === "ENOSPC")
      throw new Error(`No space left on device: ${resolvedPath}`);
    else if (err.code === "EISDIR")
      throw new Error(`Path is a directory: ${resolvedPath}`);
    else if (err.message) throw err;
    else throw new Error(`Failed to write file: ${err}`);
  }
}
