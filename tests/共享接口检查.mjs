import assert from 'node:assert/strict';
const base=process.argv[2] || 'http://127.0.0.1:5173';
const phrase='检查厨房-'+crypto.randomUUID();
async function login(passphrase,role){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase,role})});const p=await r.json();assert.equal(r.status,200,JSON.stringify(p));return p.token;}
async function read(token){const r=await fetch(base+'/api/kitchen',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);return r.json();}
async function change(token,input){const r=await fetch(base+'/api/kitchen',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)});const p=await r.json();assert.equal(r.status,200,JSON.stringify(p));return p;}
assert.equal((await fetch(base+'/api/kitchen')).status,401);
const a=await login(phrase,0),b=await login(phrase,1),other=await login(phrase+'另一份',0);
await Promise.all([change(a,{action:'pantryAdd',name:'萝卜'}),change(b,{action:'pantryAdd',name:'排骨'})]);
let state=await read(a);assert(state.kitchen.pantry.includes('萝卜'));assert(state.kitchen.pantry.includes('排骨'));assert.deepEqual((await read(other)).kitchen.pantry,[]);
state=await change(a,{action:'mealCreate'});const meal=state.kitchen.meals[0],c=meal.candidates[0];
await Promise.all([change(a,{action:'score',mealId:meal.id,candidateId:c.id,score:2}),change(b,{action:'score',mealId:meal.id,candidateId:c.id,score:5})]);
state=await read(a);assert.deepEqual(state.kitchen.meals[0].candidates[0].scores,[2,5]);
state=await change(a,{action:'shoppingGenerate'});assert(state.kitchen.shopping.length>0);
await change(b,{action:'replace',mealId:meal.id,candidateId:c.id});
const stale=await fetch(base+'/api/kitchen',{method:'POST',headers:{Authorization:'Bearer '+a,'Content-Type':'application/json'},body:JSON.stringify({action:'score',mealId:meal.id,candidateId:c.id,score:5})});assert.equal(stale.status,400);
assert.equal((await fetch(base+'/api/kitchen',{headers:{Authorization:'Bearer '+a.slice(0,-3)+'xxx'}})).status,401);
assert.equal((await fetch(base+'/api/kitchen',{method:'POST',headers:{Authorization:'Bearer '+a,'Content-Type':'application/json',Origin:'https://example.invalid'},body:JSON.stringify({action:'pantryAdd',name:'玉米'})})).status,403);
console.log('接口检查通过：同口令共享、不同口令隔离、同时评分保留双方分数、同时添加保留双方食材、旧候选评分拒绝、无登录及伪造票据拒绝、跨站写入拒绝。');
