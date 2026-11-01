import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationLog } from '../../dist/demo/validation.js';
test('physical scenarios begin NOT TESTED and PASS/FAIL requires actual observations',()=>{
 const log=new ValidationLog();assert.equal(log.rows.length,10);assert.ok(log.rows.every(r=>r.status==='NOT TESTED'));
 assert.throws(()=>log.record('iosQR','PASS',''));assert.throws(()=>log.record('unknown','PASS','observed'));
 log.record('iosQR','FAIL','Camera denied on actual phone');assert.equal(log.rows[0].status,'FAIL');
 for(let i=0;i<120;i++)log.observe('event',String(i));assert.equal(log.events.length,100);
});
