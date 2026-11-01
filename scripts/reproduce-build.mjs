/** Compare two empty, independently compiled distributions without touching demo-dist. */
import {mkdtemp,mkdir,cp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {inspectRelease} from './verify-release.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),stage=await mkdtemp(join(tmpdir(),'minimol-build-repro-'));
try {
 const results=[];
 for(const id of ['a','b']){const compiled=join(stage,id,'compiled'),bundle=join(stage,id,'package');await mkdir(bundle,{recursive:true});
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(root,'tsconfig.json'),'--outDir',compiled,'--sourceMap','false','--declaration','false'],{cwd:root,stdio:'inherit'});
 execFileSync(process.execPath,[join(root,'scripts/build-demo.mjs'),'--out',join(bundle,'demo'),'--dist',compiled],{cwd:root,stdio:'inherit'});
 await cp(join(root,'release-content'),bundle,{recursive:true});await cp(join(root,'docs'),join(bundle,'docs'),{recursive:true});results.push(await inspectRelease(bundle));}
 assert.deepEqual(results[0],results[1]);
 const report={status:'PASS',node:process.version,independentCleanCompilations:2,byteIdentical:true,buildId:results[0].buildId,filesCompared:results[0].files.length};
 await writeFile(join(root,'artifacts/reports/milestone7-build-reproducibility.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{await rm(stage,{recursive:true,force:true})}
