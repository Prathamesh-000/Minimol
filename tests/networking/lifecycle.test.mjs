import test from 'node:test';
import assert from 'node:assert/strict';
import {LifecycleGuard,bindLifecycle} from '../../dist/demo/lifecycle.js';
test('manual offers survive background waiting; active sessions are invalidated',()=>{
 let active=false;const reasons=[];const g=new LifecycleGuard(()=>active,r=>{reasons.push(r);active=false});
 g.transition('hidden');assert.equal(reasons.length,0);active=true;g.transition('hidden');assert.equal(reasons.length,1);assert.match(g.recovery,/discarded/);g.transition('visible');assert.equal(reasons.length,1);
});
test('timer suspension or wall-clock gap rejects stale active work before reply handling',()=>{
 let active=true;const reasons=[];const g=new LifecycleGuard(()=>active,r=>{reasons.push(r);active=false});g.reset(100,100);
 assert.equal(g.check(101,101),true);assert.equal(g.check(12000,102),false);assert.match(reasons[0],/paused/);assert.equal(g.check(12001,103),true);
});
test('lifecycle event bindings are fully removable on unload',()=>{
 const doc=new EventTarget(),win=new EventTarget();doc.hidden=true;let active=true,n=0;
 const g=new LifecycleGuard(()=>active,()=>{n++;active=false});const detach=bindLifecycle(g,doc,win);
 doc.dispatchEvent(new Event('visibilitychange'));assert.equal(n,1);detach();doc.dispatchEvent(new Event('resume'));win.dispatchEvent(new Event('pageshow'));assert.equal(g.lastEvent,'hidden');
});
