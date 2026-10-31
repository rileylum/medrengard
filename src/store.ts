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

/** A document artifact, such as the owner's request: a title and a text body. */
export type Document = { kind: "document"; fields: { title: string }; body: string };

export type Artifact = Document;

/** Keeps artifacts and their bodies in `directory`, each under the sha256 of its bytes. */
export function createStore(directory: string) {
  mkdirSync(directory, { recursive: true });

  function keep(bytes: string): string {
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
    /** Keeps an artifact and returns its hash, which covers its kind, fields and body hash. */
    put({ kind, fields, body }: Artifact): string {
      // lazy: fields hash in the order they were written. Sort them once a kind has more than one.
      return keep(JSON.stringify({ kind, fields, body: keep(body) }));
    },

    /** Reads back the artifact kept under `hash`. */
    get(hash: string): Artifact {
      const { kind, fields, body } = JSON.parse(readFileSync(join(directory, hash), "utf8"));

      return { kind, fields, body: readFileSync(join(directory, body), "utf8") };
    },
  };
}
