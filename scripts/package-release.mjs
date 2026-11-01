import { mkdtemp, cp, mkdir, rename, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { archiveRelease } from './archive-release.mjs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),destination=resolve(root,'release');
const stage=await mkdtemp(join(tmpdir(),'minimol-release-'));
try{
 const compiled=join(stage,'compiled'),bundle=join(stage,'package');await mkdir(bundle);
 execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(root,'tsconfig.json'),'--outDir',compiled,'--sourceMap','false','--declaration','false'],{cwd:root,stdio:'inherit'});
 execFileSync(process.execPath,[join(root,'scripts/build-demo.mjs'),'--out',join(bundle,'demo'),'--dist',compiled],{cwd:root,stdio:'inherit'});
 await cp(join(root,'release-content'),bundle,{recursive:true});
 await cp(join(root,'docs'),join(bundle,'docs'),{recursive:true});
 execFileSync(process.execPath,[join(root,'scripts/verify-release.mjs'),'--root',bundle,'--write'],{cwd:root,stdio:'inherit'});
 // Validate completely before replacing the previous generated release. Preserve user additions.
 let exists=false;try{await access(destination);exists=true}catch{}
 if(exists)execFileSync(process.execPath,[join(root,'scripts/verify-release.mjs'),'--root',destination],{cwd:root,stdio:'inherit'});
 const backup=join(root,'.release-previous');
 if(exists){const archive=await archiveRelease(root,destination);console.log('Preserved prior release:',archive);await rename(destination,backup);}
 try{await cp(bundle,destination,{recursive:true});}catch(error){await rm(destination,{recursive:true,force:true});if(exists)await rename(backup,destination);throw error;}
 if(exists)await rm(backup,{recursive:true});
 console.log('Verified release/ created. Serve release/demo/; keep private model artifacts outside the web root.');
}finally{await rm(stage,{recursive:true,force:true});}
