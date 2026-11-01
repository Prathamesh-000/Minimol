import { cp, mkdir, readFile, access, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRelease } from './verify-release.mjs';
export async function archiveRelease(root, destination) {
 await verifyRelease(destination);
 const bytes=await readFile(join(destination,'RELEASE_MANIFEST.json'));
 const manifest=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
 const directory=join(root,'release-archives');await mkdir(directory,{recursive:true});
 const target=join(directory,`${manifest.buildId}-${hash.slice(0,12)}`);
 let exists=false;try{await access(target);exists=true}catch{}
 if(exists){await verifyRelease(target);if(!(await readFile(join(target,'RELEASE_MANIFEST.json'))).equals(bytes))throw new Error('Archive collision; refusing overwrite');return target;}
 const temporary=await mkdtemp(join(directory,'.archive-'));
 try{await cp(destination,temporary,{recursive:true});await verifyRelease(temporary);await rename(temporary,target);}catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
 return target;
}
