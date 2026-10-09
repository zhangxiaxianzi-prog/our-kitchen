import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { createServer } = require('../wechat-gateway/server.cjs');
// 只操作新建的测试厨房，不使用两个人的实际口令和食材。
const website = 'https://our-kitchen-oct09.berryokapi.chatgpt.site';
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const gateway = 'http://127.0.0.1:' + server.address().port;
async function request(base, path, method, input, token) {
 const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = 'Bearer ' + token;
 const response = await fetch(base + path, { method, headers, body: input ? JSON.stringify(input) : undefined });
 const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
try {
 const phrase = '小程序共享检查-' + crypto.randomUUID();
 const boy = (await request(website, '/api/login', 'POST', {passphrase:phrase, role:0})).token;
 const girl = (await request(gateway, '/api/login', 'POST', {passphrase:phrase, role:1})).token;
 const write = (base, token, input) => request(base, '/api/kitchen', 'POST', input, token);
 const read = (base, token) => request(base, '/api/kitchen', 'GET', null, token);
 await Promise.all([write(website,boy,{action:'pantryAdd',name:'萝卜'}),write(gateway,girl,{action:'pantryAdd',name:'排骨'})]);
 let state = await read(gateway,girl); assert.deepEqual([...state.kitchen.pantry].sort(),['排骨','萝卜'].sort());
 // 清空测试冰箱，让采购清单检查不受随机选中已有食材菜品的影响。
 await write(website,boy,{action:'pantryRemove',name:'萝卜'}); await write(gateway,girl,{action:'pantryRemove',name:'排骨'});
 state = await write(gateway,girl,{action:'mealCreate'}); const meal = state.kitchen.meals[0]; assert.equal(meal.candidates.filter(c=>c.dish.kind==='meat').length,1); assert.equal(meal.candidates.length,3);
 const candidate = meal.candidates[0]; await Promise.all([write(website,boy,{action:'score',mealId:meal.id,candidateId:candidate.id,score:2}),write(gateway,girl,{action:'score',mealId:meal.id,candidateId:candidate.id,score:5})]);
 state = await read(website,boy); assert.deepEqual(state.kitchen.meals[0].candidates[0].scores,[2,5]);
 state = await write(gateway,girl,{action:'shoppingGenerate'}); assert(state.kitchen.shopping.length); const bought=state.kitchen.shopping[0].name;
 await write(website,boy,{action:'shoppingCheck',name:bought,checked:true}); state=await write(gateway,girl,{action:'shoppingToPantry'}); assert(state.kitchen.pantry.includes(bought));
 state=await write(gateway,girl,{action:'dishSave',name:'共享检查测试菜',kind:'veg',ingredients:['萝卜']}); const dish=state.kitchen.dishes.find(d=>d.name==='共享检查测试菜'); assert(dish);
 state=await write(website,boy,{action:'dishToggle',id:dish.id}); assert.equal(state.kitchen.dishes.find(d=>d.id===dish.id).active,false);
 state=await write(gateway,girl,{action:'dishToggle',id:dish.id}); assert.equal(state.kitchen.dishes.find(d=>d.id===dish.id).active,true);
 await write(gateway,girl,{action:'dishDelete',id:dish.id}); state=await read(website,boy); assert(!state.kitchen.dishes.some(d=>d.id===dish.id));
 state=await write(gateway,girl,{action:'replace',mealId:meal.id,candidateId:candidate.id}); assert.deepEqual(state.kitchen.meals[0].candidates[0].scores,[null,null]);
 assert.equal((await fetch(gateway+'/health')).status,200);
 console.log('通过：网站与本地接入服务共用厨房，同时添加和评分保留双方结果，一荤两素，采购入冰箱，增删和停用恢复菜单，换菜清空分数。');
 console.log('此检查没有调用微信云托管，也不代表小程序已发布或通过真机验证。');
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
