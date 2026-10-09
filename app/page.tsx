'use client';
import { useEffect, useRef, useState } from 'react';
import { CookingPot, Refrigerator, ShoppingBasket, BookOpen, ArrowRight, Plus, X, Shuffle, Check, Leaf, Beef, RefreshCw, Pencil, Trash2, ChevronDown, LogOut, LockKeyhole, Search, Utensils } from 'lucide-react';
import type { Dish } from '../lib/menu';
import type { Kitchen, Candidate } from '../lib/kitchen';
type Payload = { role: 0 | 1; version: number; kitchen: Kitchen };
type Tab = 'dinner' | 'fridge' | 'shopping' | 'menu';
const navigation = [{ id: 'dinner', name: '今晚吃什么', icon: CookingPot }, { id: 'fridge', name: '我们的冰箱', icon: Refrigerator }, { id: 'shopping', name: '采购清单', icon: ShoppingBasket }, { id: 'menu', name: '日常菜单', icon: BookOpen }] as const;
// 分数空着时要等另一人评分，不能把没打分当成不想吃。
function verdict(c: Candidate) { return c.scores.some(x => x === null) ? 'waiting' : Number(c.scores[0]) + Number(c.scores[1]) >= 7 ? 'yes' : 'no'; }
function Illustration({ dish }: { dish: Dish }) {
  return <div className={'dish-art ' + dish.kind} aria-hidden="true"><div className="plate"><div className="food-shape one"/><div className="food-shape two"/><div className="food-shape three"/><div className="food-shape four"/><div className="food-shape five"/><div className="food-shape six"/></div><span>{dish.kind === 'meat' ? '荤菜' : '素菜'}</span></div>;
}
export default function Home() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>('dinner');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fridgeOnly, setFridgeOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [ingredient, setIngredient] = useState('');
  const [edit, setEdit] = useState<Dish | 'new' | null>(null);
  const [name, setName] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [kind, setKind] = useState<'meat' | 'veg'>('veg');
  const [pick, setPick] = useState<Candidate | null>(null);
  const [history, setHistory] = useState(false);
  const [ready, setReady] = useState(false);
  const version = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 登录钥匙留在当前手机，食材和评分每次从云端读取。
  useEffect(() => {
    const key = localStorage.getItem('kitchen-key') || '';
    if (key) setToken(key);
    setReady(true);
  }, []);
  function accept(payload: Payload) { if (payload.version >= version.current) { version.current = payload.version; setData(payload); } }
  // 定时刷新让另一人的修改出现；旧请求晚到时不能覆盖较新的数据。
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try { const r = await fetch('/api/kitchen', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }); const p = await r.json() as Payload & {error?:string}; if (!alive) return; if (!r.ok) throw new Error(p.error); accept(p); setError(''); }
      catch (e) { if (alive) setError(e instanceof Error ? e.message : '同步失败，请重试'); }
    };
    load(); const interval = setInterval(load, 8000);
    return () => { alive = false; clearInterval(interval); };
  }, [token]);
  function notify(text: string) { setMessage(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setMessage(''), 4500); }
  // 写入成功后才更新页面，失败保留用户原来的输入。
  async function action(input: Record<string, unknown>, success = ''): Promise<boolean> {
    if (busy) return false; setBusy(true);
    try { const r = await fetch('/api/kitchen', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const p = await r.json() as Payload & {error?:string}; if (!r.ok) throw new Error(p.error); accept(p); if (success) notify(success); setError(''); return true; }
    catch (e) { notify(e instanceof Error ? e.message : '保存失败，请重试'); return false; }
    finally { setBusy(false); }
  }
  function logout() { localStorage.removeItem('kitchen-key'); setToken(''); setData(null); version.current = 0; setError(''); }
  function openEditor(d: Dish | 'new') { setEdit(d); setName(d === 'new' ? '' : d.name); setIngredients(d === 'new' ? '' : d.ingredients.join('、')); setKind(d === 'new' ? 'veg' : d.kind); }
  const k = data?.kitchen;
  const meal = k?.meals[0];
  const passed = meal?.candidates.filter(c => verdict(c) === 'yes') || [];
  const allIngredients = [...new Set(k?.dishes.flatMap(d => d.ingredients) || [])].sort((a,b) => a.localeCompare(b, 'zh-CN'));
  const missing = (d: Dish) => d.ingredients.filter(x => !k?.pantry.includes(x));
  const visible = k?.dishes.filter(d => (filter === 'hidden' ? !d.active : d.active) && (filter !== 'meat' || d.kind === 'meat') && (filter !== 'veg' || d.kind === 'veg') && (filter !== 'ready' || missing(d).length === 0) && (d.name.includes(search) || d.ingredients.some(i => i.includes(search)))) || [];
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  if (!ready) return <div className="loading">正在打开两人厨房…</div>;
  if (!token) return <Login onLogin={key => { localStorage.setItem('kitchen-key', key); setToken(key); }} />;
  if (!data) return <div className="entrance"><CookingPot size={42}/><h1>两人厨房</h1><p>{error || '正在读取你们的厨房…'}</p><button className="secondary" onClick={logout}>返回登录</button></div>;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-icon"><CookingPot size={24}/></div><div>两人厨房<small>把晚饭，一起决定</small></div></div><div className="nav-label">我们的一日三餐</div><nav>{navigation.map(n => <button key={n.id} onClick={() => { setTab(n.id); setSearch(''); setIngredient(''); }} className={tab === n.id ? 'nav-item selected' : 'nav-item'}><n.icon size={20}/><span>{n.name}</span>{tab === n.id && <span className="nav-dot"/>}</button>)}</nav><div className="sidebar-note"><Leaf size={22}/><p>先看看冰箱，<br/>再决定吃什么。</p><small>主要食材够不够分量，<br/>做饭前再确认一下。</small></div><div className="identity"><span className="avatar">{data.role === 0 ? '一' : '二'}</span><div>我的评分身份<small>{data.role === 0 ? '我' : '女朋友'}</small></div><button title="退出登录" className="icon-button" onClick={logout}><LogOut size={17}/></button></div></aside>
    <main><header className="topbar"><span>{date}</span><div className="top-actions"><div className={'sync ' + (error ? 'offline' : '')}><span/>{error ? '同步暂时中断' : busy ? '正在保存' : '共享厨房'}</div><button className="identity-switch" onClick={logout}>{data.role === 0 ? '我' : '女朋友'} · 切换</button></div></header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {tab === 'dinner' && <>
        <section className="hero"><div><p className="eyebrow">今晚的餐桌</p><h1>今晚吃什么，<br/><span>我们一起决定。</span></h1><p className="hero-copy">从冰箱里找灵感，选出两个人都想吃的三道菜。</p><div className="hero-actions"><button className="primary" disabled={busy} onClick={() => { if (meal && !window.confirm('开始新一轮选菜？当前晚餐会保留在历史里。')) return; action({ action: 'mealCreate', fridge: fridgeOnly }, '新的候选菜已准备好'); }}><Shuffle size={18}/>{meal ? '重新搭配三道菜' : '帮我们搭配三道菜'}<ArrowRight size={17}/></button><label className="check-label"><input type="checkbox" checked={fridgeOnly} onChange={e => setFridgeOnly(e.target.checked)}/>只用冰箱已有食材</label></div></div><div className="hero-graphic" aria-hidden="true"><div className="table-circle"><Utensils size={60} strokeWidth={1}/><span>一荤 · 两素</span></div><div className="tiny-note">两个人的晚餐</div></div></section>
        <div className="section-heading"><div><h2>{meal ? '今晚的三道候选菜' : '给今晚留一点期待'}</h2><p>每人 0–5 分，合计满 7 分入选。没评分，就先等一等。</p></div><span className="count-label">已入选 <b>{passed.length}</b> / 3</span></div>
        {!meal ? <div className="empty dinner-empty"><CookingPot size={34}/><h3>晚餐还没开始选</h3><p>点击上方搭配按钮，再分别给三道菜打分。<br/>也可以先去冰箱里添加已有食材。</p><button className="text-button" onClick={() => setTab('fridge')}>去整理冰箱 <ArrowRight size={16}/></button></div> : <div className="meal-grid">{meal.candidates.map((c, i) => <article key={c.id} className={'meal-card status-' + verdict(c)}><Illustration dish={c.dish}/><div className="meal-body"><div className="dish-index">{String(i + 1).padStart(2,'0')} / {c.dish.kind === 'meat' ? '荤菜' : '素菜'}</div><h3>{c.dish.name}</h3><div className="ingredient-tags">{c.dish.ingredients.map(n => <span key={n} className={k!.pantry.includes(n) ? 'owned' : ''}>{k!.pantry.includes(n) && <Check size={11}/>} {n}</span>)}</div><p className={'availability ' + (missing(c.dish).length ? 'needs' : '')}>{missing(c.dish).length ? '还缺：' + missing(c.dish).join('、') : '主要食材已齐'}</p><div className="rating-label">我想吃的程度 <b>{c.scores[data.role] === null ? '未评分' : c.scores[data.role] + ' 分'}</b></div><div className="score-buttons">{[0,1,2,3,4,5].map(score => <button disabled={busy} key={score} className={c.scores[data.role] === score ? 'chosen' : ''} aria-label={c.dish.name + '评分' + score + '分'} onClick={() => action({ action: 'score', mealId: meal.id, candidateId: c.id, score })}>{score}</button>)}</div><div className="partner-score">另一位：{c.scores[1 - data.role] === null ? '还没评分' : c.scores[1 - data.role] + ' 分'}<span>{c.scores.every(x => x !== null) ? `合计 ${Number(c.scores[0]) + Number(c.scores[1])} / 10` : '等待两人评分'}</span></div><div className="card-bottom"><span className="verdict">{verdict(c) === 'yes' ? '已入选' : verdict(c) === 'no' ? '未入选' : '等待评分'}</span><div><button className="text-button" disabled={busy} onClick={() => action({ action: 'replace', mealId: meal.id, candidateId: c.id, fridge: fridgeOnly }, '已换菜，请重新评分')}><RefreshCw size={13}/>换一道</button><button className="text-button" onClick={() => { setPick(c); setSearch(''); }}>自选</button></div></div></div></article>)}</div>}
        <section className="shopping-callout"><div className="callout-icon"><ShoppingBasket size={24}/></div><div><h3>选好了，再去买菜</h3><p>把已入选菜缺少的食材合并，冰箱里有的就不用买。</p></div><button className="secondary" disabled={busy || !passed.length} onClick={async () => { if (await action({ action: 'shoppingGenerate' }, '采购清单已更新')) setTab('shopping'); }}>生成采购清单 <ArrowRight size={16}/></button></section>
        {!!k!.meals.length && <section className="history"><button className="history-toggle" onClick={() => setHistory(!history)}>之前的晚餐 <span>最近 {Math.max(0,k!.meals.length - 1)} 轮 <ChevronDown size={16}/></span></button>{history && (k!.meals.length < 2 ? <p className="muted">还没有历史晚餐。</p> : k!.meals.slice(1).map(m => <div className="history-row" key={m.id}><b>{m.date}</b>{m.candidates.map(c => <span key={c.id}>{c.dish.name} · {c.scores.some(x => x === null) ? '未完成评分' : `${Number(c.scores[0])+Number(c.scores[1])}分，${verdict(c) === 'yes' ? '入选' : '未入选'}`}</span>)}</div>))}</section>}
      </>}
      {tab === 'fridge' && <><PageHeading eyebrow="已有的，先吃好" title="我们的冰箱" description="只记主要食材，不记重量。用完了就移除，两个人都能看到。"/><form className="add-bar" onSubmit={async e => { e.preventDefault(); if (await action({ action:'pantryAdd', name: ingredient },'已加入冰箱')) setIngredient(''); }}><Refrigerator size={20}/><input aria-label="添加冰箱食材" placeholder="添加食材，如萝卜、排骨或西红柿" value={ingredient} maxLength={40} onChange={e=>setIngredient(e.target.value)}/><button className="primary" disabled={busy || !ingredient.trim()}><Plus size={17}/>添加</button></form><div className="section-heading"><h2>已经有的食材</h2><span className="count-label">{k!.pantry.length} 种</span></div><div className="pantry-list">{k!.pantry.map(n=><div className="pantry-item" key={n}><Leaf size={17}/><b>{n}</b><button className="icon-button" aria-label={'移除'+n} disabled={busy} onClick={()=>action({action:'pantryRemove',name:n})}><X size={16}/></button></div>)}</div>{!k!.pantry.length && <div className="empty"><Refrigerator size={36}/><h3>先把已有食材记下来</h3><p>这里没有预填库存，按你们冰箱里的实际情况添加。</p></div>}<h2 className="subheading">常用食材，点一下添加</h2><div className="suggestion-chips">{allIngredients.filter(n=>!k!.pantry.includes(n) && (!ingredient || n.includes(ingredient))).map(n=><button key={n} disabled={busy} onClick={()=>action({action:'pantryAdd',name:n})}><Plus size={12}/>{n}</button>)}</div><section className="shopping-callout"><div className="callout-icon"><CookingPot size={23}/></div><div><h3>{k!.dishes.filter(d=>d.active && !missing(d).length).length} 道菜的主要食材已齐</h3><p>分量和调料请在做饭前自行确认。</p></div><button className="secondary" onClick={()=>{setTab('menu');setFilter('ready');}}>看看能做什么 <ArrowRight size={16}/></button></section></>}
      {tab === 'shopping' && <><PageHeading eyebrow="带着清单，去买菜" title="采购清单" description="两个人共用一张清单。买到了打个勾，确认后加入冰箱。"/><form className="add-bar" onSubmit={async e=>{e.preventDefault();if(await action({action:'shoppingAdd',name:ingredient},'已加入采购清单'))setIngredient('');}}><ShoppingBasket size={20}/><input aria-label="添加采购食材" value={ingredient} maxLength={40} placeholder="还有想买的？在这里添加" onChange={e=>setIngredient(e.target.value)}/><button className="primary" disabled={busy || !ingredient.trim()}><Plus size={17}/>添加</button></form><div className="section-heading"><h2>要买的食材</h2><span className="count-label">已买 {k!.shopping.filter(x=>x.checked).length} / {k!.shopping.length}</span></div><div className="shopping-list">{k!.shopping.map(x=><div className={'shopping-item '+(x.checked?'done':'')} key={x.name}><label><input type="checkbox" checked={x.checked} disabled={busy} onChange={e=>action({action:'shoppingCheck',name:x.name,checked:e.target.checked})}/><span>{x.name}</span></label><button className="icon-button" aria-label={'移除采购项'+x.name} disabled={busy} onClick={()=>action({action:'shoppingRemove',name:x.name})}><X size={17}/></button></div>)}</div>{!k!.shopping.length && <div className="empty"><ShoppingBasket size={36}/><h3>清单还是空的</h3><p>晚餐评分通过后生成清单，也可以直接添加想买的食材。</p></div>}<div className="shopping-footer"><p>不会因为打勾就自动修改冰箱。</p><button className="primary" disabled={busy || !k!.shopping.some(x=>x.checked)} onClick={()=>action({action:'shoppingToPantry'},'买到的食材已加入冰箱，并从清单移除')}><Check size={18}/>把买到的加入冰箱</button></div></>}
      {tab === 'menu' && <><PageHeading eyebrow="把想吃的，都记下来" title="我们的日常菜单" description="来自你的菜单照片，也可以加入你们自己的拿手菜。"/><div className="menu-tools"><label className="search"><Search size={18}/><input value={search} aria-label="搜索菜名或食材" placeholder="搜索菜名或食材" onChange={e=>setSearch(e.target.value)}/></label><button className="primary" onClick={()=>openEditor('new')}><Plus size={17}/>新增菜品</button></div><div className="filter-tabs">{[['active','全部推荐'],['meat','荤菜'],['veg','素菜'],['ready','食材已齐'],['hidden','不再推荐']].map(([v,l])=><button key={v} className={filter===v?'active':''} onClick={()=>setFilter(v)}>{l}</button>)}</div><p className="menu-note">食材按常见做法整理，可编辑。含肉菜按荤菜算；鸡蛋和奶制品归入素菜。</p><div className="menu-list">{visible.map(d=><article className="menu-row" key={d.id}><div className={'kind-mark '+d.kind}>{d.kind==='meat'?<Beef size={20}/>:<Leaf size={20}/>}</div><div className="menu-info"><h3>{d.name}<span>{d.kind==='meat'?'荤菜':'素菜'}</span></h3><p>{d.ingredients.join(' · ')}</p><small>{missing(d).length ? '还缺：'+missing(d).join('、') : '主要食材已齐'}</small></div><div className="menu-row-actions"><button className="icon-button" title="编辑菜品" onClick={()=>openEditor(d)}><Pencil size={16}/></button><button className="secondary mini" disabled={busy} onClick={()=>action({action:'dishToggle',id:d.id},d.active?'已设为不再推荐':'已恢复推荐')}>{d.active?'不再推荐':'恢复推荐'}</button><button className="icon-button danger" title="永久删除" disabled={busy} onClick={()=>{if(window.confirm(`永久删除“${d.name}”？菜单里无法恢复，历史晚餐仍保留当时的记录。`))action({action:'dishDelete',id:d.id},'已永久删除菜品');}}><Trash2 size={16}/></button></div></article>)}</div>{!visible.length && <div className="empty"><BookOpen size={34}/><h3>这里还没有符合条件的菜</h3><p>换个搜索词，或添加一道新菜。</p></div>}</>}
      <footer>两人厨房 <span>菜单可以变，晚饭一起决定。</span></footer>
    </main><nav className="mobile-nav">{navigation.map(n=><button key={n.id} className={tab===n.id?'selected':''} onClick={()=>{setTab(n.id);setIngredient('');setSearch('');}}><n.icon size={21}/><span>{n.name.replace('我们的','').replace('日常','')}</span></button>)}</nav>
    {message && <div className="toast" role="status">{message}</div>}
    {edit && <div className="modal-overlay" onClick={()=>setEdit(null)}><section className="modal" role="dialog" aria-modal="true" aria-label="编辑菜品" onClick={e=>e.stopPropagation()}><div className="modal-heading"><h2>{edit==='new'?'新增一道菜':'编辑菜品'}</h2><button className="icon-button" aria-label="关闭" onClick={()=>setEdit(null)}><X size={21}/></button></div><form onSubmit={async e=>{e.preventDefault();if(await action({action:'dishSave',id:edit==='new'?undefined:edit.id,name,kind,ingredients:ingredients.split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean)},'菜单已保存'))setEdit(null);}}><label className="field">菜名<input required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="比如，番茄炒蛋"/></label><label className="field">荤素分类<select value={kind} onChange={e=>setKind(e.target.value as 'meat'|'veg')}><option value="veg">素菜（含蛋类）</option><option value="meat">荤菜（含肉）</option></select></label><label className="field">主要食材<textarea required value={ingredients} onChange={e=>setIngredients(e.target.value)} maxLength={800} placeholder="用顿号分开，如：番茄、鸡蛋"/></label><p className="muted">只填主要食材，最多20种；不需要重量和常用调料。修改菜单不会改变已经生成的候选菜。</p><button className="primary full" disabled={busy}>保存菜品</button></form></section></div>}
    {pick && <div className="modal-overlay" onClick={()=>setPick(null)}><section className="modal" role="dialog" aria-modal="true" aria-label="手动选菜" onClick={e=>e.stopPropagation()}><div className="modal-heading"><h2>选一道{pick.dish.kind==='meat'?'荤菜':'素菜'}</h2><button className="icon-button" aria-label="关闭" onClick={()=>setPick(null)}><X size={21}/></button></div><label className="search"><Search size={18}/><input aria-label="搜索候选菜" placeholder="搜索菜名或食材" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="pick-list">{k!.dishes.filter(d=>d.active && d.kind===pick.dish.kind && !meal?.candidates.some(c=>c.dish.id===d.id) && (d.name.includes(search)||d.ingredients.some(x=>x.includes(search))) && (!fridgeOnly || !missing(d).length)).map(d=><button key={d.id} disabled={busy} onClick={async()=>{if(await action({action:'pick',mealId:meal?.id,candidateId:pick.id,dishId:d.id},'已选菜，请重新评分'))setPick(null);}}><div><b>{d.name}</b><small>{d.ingredients.join('、')}</small></div><ArrowRight size={17}/></button>)}</div></section></div>}
  </div>;
}
function PageHeading({eyebrow,title,description}:{eyebrow:string;title:string;description:string}){return <section className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></section>;}
// 登录组件只负责收集输入，最终由服务端决定厨房和评分身份。
function Login({onLogin}:{onLogin:(key:string)=>void}) {
  const [passphrase,setPassphrase]=useState('');
  const [role,setRole]=useState<0|1>(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  // 两个人输入同一口令即可共享；换身份需要重新登录，服务器会重新签发身份票据。
  async function login(e: React.FormEvent) {
    e.preventDefault(); if(busy)return; setBusy(true);setError('');
    try {const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase,role})});const result=await response.json() as {token:string;error?:string};if(!response.ok)throw new Error(result.error);setPassphrase('');onLogin(result.token);}
    catch(e){setError(e instanceof Error?e.message:'登录失败，请重试');}finally{setBusy(false);}
  }
  return <div className="login-page"><div className="login-brand"><CookingPot size={24}/>两人厨房</div><div className="login-layout"><section className="login-intro"><p className="eyebrow">一张菜单，两个人的晚餐</p><h1>少一点纠结，<br/>一起吃顿好饭。</h1><p>冰箱里有什么，今晚想吃什么。<br/>把两个人的想法，放到同一张餐桌上。</p><div className="login-points"><span><Refrigerator size={18}/>共享冰箱</span><span><CookingPot size={18}/>一起评分</span><span><ShoppingBasket size={18}/>买菜清单</span></div></section><section className="login-card"><div className="brand-icon"><LockKeyhole size={25}/></div><h2>进入我们的厨房</h2><p>约定一个共同口令，两个人输入完全相同的口令，就会进入同一个厨房。</p><form onSubmit={login}><label className="field">共同口令<input required minLength={8} maxLength={64} value={passphrase} onChange={e=>setPassphrase(e.target.value)} type="password" autoComplete="current-password" placeholder="8到64个字符，区分大小写"/></label><label className="field">这次以谁的身份进入</label><div className="role-select"><button type="button" className={role===0?'active':''} onClick={()=>setRole(0)}>男生</button><button type="button" className={role===1?'active':''} onClick={()=>setRole(1)}>女朋友</button></div>{error&&<p className="error-banner" role="alert">{error}</p>}<button className="primary full" disabled={busy}>{busy?'正在进入…':'创建 / 进入厨房'}<ArrowRight size={17}/></button></form><small>第一次使用会创建厨房。输错口令会进入不同厨房，请先核对口令。知道口令的人可以选择任一身份，请保管好口令。手机会记住登录30天。</small></section></div></div>;
}
