/** Read-only offline validation. Never invokes a model, writes flags or deploys. */
import { readFileSync, statSync } from 'node:fs';
import { validateCostBenchmarkManifest, validateCostBenchmarkPolicy, evaluateCostBenchmarkManifests } from '../src/services/cost-benchmark-manifest.ts';

const argv=process.argv.slice(2);
if(argv.length!==6 || argv[0]!=='--before' || argv[2]!=='--after' || argv[4]!=='--policy') {
  process.stderr.write('Usage: node --experimental-strip-types scripts/evaluate-cost-benchmark.mjs --before private-baseline.json --after private-candidate.json --policy private-approved-policy.json\n');
  process.exitCode=2;
} else {
  const read=(path)=>{
    if(statSync(path).size>1_000_000) throw new Error('INPUT_SIZE_LIMIT');
    return JSON.parse(readFileSync(path,'utf8'));
  };
  try {
    const reference=read(new URL('../evals/reference-set.json',import.meta.url));
    const before=validateCostBenchmarkManifest(read(argv[1]),reference);
    const after=validateCostBenchmarkManifest(read(argv[3]),reference);
    const result=evaluateCostBenchmarkManifests(before,after,validateCostBenchmarkPolicy(read(argv[5])));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    process.exitCode=result.candidatePassesSuppliedMeasurements?0:1;
  } catch(error) {
    // Never echo malformed values, input paths or arbitrary exception text.
    const code=/^[A-Z_]+$/.test(String(error?.message))?error.message:'INVALID_OR_UNREADABLE_INPUT';
    process.stderr.write(JSON.stringify({success:false,code,activationPerformed:false})+'\n');
    process.exitCode=2;
  }
}
