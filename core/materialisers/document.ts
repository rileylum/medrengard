/** The document kind's materialiser: writes the document's body to `document` in the workspace. */
import { copyFileSync } from "node:fs";
import { join } from "node:path";

copyFileSync(join(process.env.MEDRENGARD_IN!, "body"), "document");
