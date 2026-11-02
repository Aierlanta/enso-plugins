export const HOME = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EnsoCode 插件市场</title>
<meta name="description" content="EnsoCode 官方插件市场：浏览、搜索插件，在 EnsoCode 设置 → 插件 → 市场中一键安装。">
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--mut:#78716c;--line:#e7e5e4;--card:#fff;--acc:#0f766e;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#e7e5e4;--mut:#a8a29e;--line:#292524;--card:#1c1917;--acc:#2dd4bf}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:56px 20px 80px}
h1{font-size:32px;margin:0 0 8px;letter-spacing:-.02em}.sub{color:var(--mut);margin:0 0 28px}
.bar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
input{flex:1;min-width:220px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg);font:inherit}
button.f{padding:8px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--mut);font:inherit;cursor:pointer}
button.f[aria-pressed=true]{color:var(--fg);border-color:var(--acc)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:8px}
.top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.name{font-weight:600;font-size:16px}
.ver,.id{color:var(--mut);font-size:12px;font-family:ui-monospace,Menlo,monospace}
.tier{font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--mut)}.tier.official{color:var(--acc);border-color:var(--acc)}
.desc{margin:0;color:var(--mut);font-size:14px;flex:1}
.tags{display:flex;gap:6px;flex-wrap:wrap}.tags span{font-size:12px;color:var(--mut)}
.perm{font-size:12px;color:var(--mut)}.perm code{font-size:11px}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
.how{margin-top:40px;padding:18px;border:1px dashed var(--line);border-radius:14px;color:var(--mut);font-size:14px}
footer{margin-top:28px;color:var(--mut);font-size:13px}.empty{color:var(--mut)}
</style>
</head>
<body>
<main>
<h1>EnsoCode 插件市场</h1>
<p class="sub">所有插件包都经过 Ed25519 签名索引和 sha256 校验，客户端不信任任何分发节点。</p>
<div class="bar">
<input id="q" type="search" placeholder="搜索插件名、描述、标签…" autofocus>
<button class="f" data-t="" aria-pressed="true">全部</button>
<button class="f" data-t="official" aria-pressed="false">官方</button>
<button class="f" data-t="community" aria-pressed="false">社区</button>
</div>
<div id="list" class="grid"><p class="empty">加载中…</p></div>
<div class="how">在 EnsoCode 中打开 <b>设置 → 插件 → 市场</b>，搜索并安装。想发布插件？向 <a href="https://github.com/J3n5en/enso-plugins">J3n5en/enso-plugins</a> 提交 Pull Request。</div>
<footer id="meta"></footer>
</main>
<script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let all=[],tier='';
function render(){
  const q=document.getElementById('q').value.trim().toLowerCase();
  const hit=all.filter(p=>(!tier||p.tier===tier)&&(!q||[p.id,p.name,p.description,...(p.tags||[])].join(' ').toLowerCase().includes(q)));
  document.getElementById('list').innerHTML=hit.length?hit.map(p=>{
    const v=(p.versions||[]).find(x=>x.version===p.latest)||{};
    const perms=Array.isArray(v.permissions)?v.permissions:[];
    const home=/^https:\\/\\//.test(p.homepage||'')?' · <a href="'+esc(p.homepage)+'" rel="noopener">主页</a>':'';
    return '<div class="card"><div class="top"><span class="name">'+esc(p.name||p.id)+'</span><span class="ver">v'+esc(p.latest)+'</span><span class="tier '+esc(p.tier)+'">'+(p.tier==='official'?'官方':'社区')+'</span></div>'
      +'<div class="id">'+esc(p.id)+home+'</div><p class="desc">'+esc(p.description)+'</p>'
      +(perms.length?'<div class="perm">权限：'+perms.map(x=>'<code>'+esc(x)+'</code>').join(' ')+'</div>':'')
      +((p.tags||[]).length?'<div class="tags">'+p.tags.map(t=>'<span>#'+esc(t)+'</span>').join('')+'</div>':'')+'</div>';
  }).join(''):'<p class="empty">没有匹配的插件</p>';
}
document.getElementById('q').oninput=render;
document.querySelectorAll('button.f').forEach(b=>b.onclick=()=>{tier=b.dataset.t;document.querySelectorAll('button.f').forEach(x=>x.setAttribute('aria-pressed',x===b));render();});
fetch('/v1/index.json').then(r=>r.json()).then(d=>{
  all=(d.plugins||[]).filter(p=>!/^local\\./.test(p.id));render();
  document.getElementById('meta').textContent=all.length+' 个插件 · 索引第 '+d.sequence+' 版 · 更新于 '+new Date(d.generatedAt).toLocaleString('zh-CN');
}).catch(()=>{document.getElementById('list').innerHTML='<p class="empty">索引加载失败，请稍后重试</p>';});
</script>
</body>
</html>`;
