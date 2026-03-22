import { stringifyReport } from "../report/jsonSerialize.js";
import { ConfigError } from "../imap/config.js";
import {
  readCopyFailureDetails,
  readCopyStatus,
  runCopyJob,
  setCopyPaused,
} from "../copy/jobRunner.js";
import { DEFAULT_JOB_ID } from "../copy/jobTypes.js";

function getStore(opts: Map<string, string>): string {
  const s = opts.get("--store")?.trim();
  if (!s) throw new ConfigError("copy requires --store <path.sqlite>");
  return s;
}

/**
 * Handles `imap-tool copy run|status|pause|resume`.
 */
export async function cmdCopy(
  sub: string,
  flags: Set<string>,
  opts: Map<string, string>
): Promise<void> {
  const pretty = flags.has("--pretty");
  const store = getStore(opts);
  const spec = opts.get("--spec")?.trim();
  const concRaw = opts.get("--concurrency");
  const concurrency =
    concRaw != null && Number.isFinite(Number(concRaw))
      ? Math.floor(Number(concRaw))
      : undefined;

  switch (sub) {
    case "run": {
      let stop = false;
      const onSig = () => {
        stop = true;
        console.error("copy: stopping after current messages (SIGINT)");
      };
      process.on("SIGINT", onSig);
      try {
        const stats = await runCopyJob({
          storePath: store,
          specPath: spec,
          concurrency,
          isStopped: () => stop,
          onProgress: (s) => {
            if (flags.has("--verbose")) {
              console.error(
                `copy: pending=${s.pending} appended=${s.appended} in_progress=${s.inProgress} done=${s.done} failed=${s.failed}`
              );
            }
          },
        });
        console.log(stringifyReport({ ok: true, store, stats }, pretty).trimEnd());
      } finally {
        process.off("SIGINT", onSig);
      }
      break;
    }
    case "status": {
      const { stats, paused, createdAt } = readCopyStatus(store);
      let failures: ReturnType<typeof readCopyFailureDetails> | undefined;
      if (stats.failed > 0) {
        failures = readCopyFailureDetails(store, DEFAULT_JOB_ID, {
          maxReasonGroups: 40,
          sampleLimit: flags.has("--verbose") ? 40 : 0,
        });
      }
      console.log(
        stringifyReport(
          { ok: true, store, paused, createdAt, stats, ...(failures ? { failures } : {}) },
          pretty
        ).trimEnd()
      );
      break;
    }
    case "pause":
      setCopyPaused(store, true);
      console.error(`copy: paused (${store})`);
      break;
    case "resume":
      setCopyPaused(store, false);
      console.error(`copy: resumed (${store})`);
      break;
    default:
      throw new ConfigError(`unknown copy subcommand: ${sub} (use run|status|pause|resume)`);
  }
}
