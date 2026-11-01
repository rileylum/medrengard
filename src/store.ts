import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * An artifact: its kind, its fields, and its body, if it has one. Its kind's definition says
 * which fields and body it may have; the store keeps whatever it is given.
 */
export type Artifact = { kind: string; fields: Readonly<Record<string, string>>; body?: string };

/**
 * Keeps artifacts, their bodies and transcripts in `directory`, each under the sha256 of its
 * bytes.
 */
export function createStore(directory: string) {
  mkdirSync(directory, { recursive: true });

  function keep(data: string | Buffer): string {
    const bytes = Buffer.from(data);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = join(directory, hash);

    if (!existsSync(path)) {
      // Synced aside and renamed, so a crash never leaves a partial file under a hash the log names.
      const partial = `${path}.${process.pid}.partial`;
      const file = openSync(partial, "w");

      writeSync(file, bytes);
      fsyncSync(file);
      closeSync(file);
      renameSync(partial, path);

      const parent = openSync(directory, "r");

      fsyncSync(parent);
      closeSync(parent);
    }

    return hash;
  }

  return {
    /** Keeps bytes, such as a transcript, and returns their hash. */
    keep,

    /** Reads back the bytes kept under `hash`. */
    read(hash: string): Buffer {
      return readFileSync(join(directory, hash));
    },

    /** Keeps an artifact and returns its hash, which covers its kind, fields and body hash. */
    put(artifact: Artifact): string {
      const { kind, fields } = artifact;
      const body = artifact.body === undefined ? null : keep(artifact.body);

      // lazy: fields hash in the order they were written. Sort them once a kind can be
      // written by something other than the engine.
      return keep(JSON.stringify({ kind, fields, body }));
    },

    /** Reads back the artifact kept under `hash`. */
    get(hash: string): Artifact {
      const { kind, fields, body } = JSON.parse(readFileSync(join(directory, hash), "utf8"));

      if (body === null) {
        return { kind, fields };
      }

      return { kind, fields, body: readFileSync(join(directory, body), "utf8") };
    },
  };
}
