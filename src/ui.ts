// The management page served at /. One file, no framework, no build step.
export const UI_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>bonsai — 仓库值守</title>
<style>
  :root { color-scheme: dark; }
  body { font: 14px/1.6 system-ui, sans-serif; background: #0f1115; color: #e6e6e6; margin: 0; }
  main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; } h2 { font-size: 15px; margin: 28px 0 8px; color: #9ecbff; }
  section { background: #171a21; border: 1px solid #262b36; border-radius: 10px; padding: 16px; margin-top: 12px; }
  label { display: block; margin: 10px 0 4px; color: #a9b1bd; }
  input[type=text], textarea { width: 100%; box-sizing: border-box; background: #0f1115; color: #e6e6e6;
    border: 1px solid #313845; border-radius: 6px; padding: 8px; font: inherit; }
  textarea { min-height: 64px; resize: vertical; }
  button { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font: inherit; cursor: pointer; margin: 8px 8px 0 0; }
  button.ghost { background: #262b36; }
  .row { display: flex; gap: 12px; } .row > div { flex: 1; }
  .msg { margin: 8px 0; padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; }
  .msg.user { background: #1d2634; } .msg.assistant { background: #1a2a1f; }
  .msg b { color: #9ecbff; } .msg.assistant b { color: #8fe0a2; }
  #chatlog { max-height: 420px; overflow-y: auto; }
  .hint { color: #6b7280; font-size: 12px; }
  #status { color: #fbbf24; min-height: 20px; }
</style>
</head>
<body>
<main>
  <h1>🌱 bonsai · 仓库值守 Agent</h1>
  <div id="status"></div>

  <section>
    <h2>连接</h2>
    <label>API Key（KEEPER_API_KEY，保存在浏览器本地）</label>
    <input type="text" id="apiKey" placeholder="粘贴密钥后回车">
  </section>

  <section>
    <h2>Agent 设置</h2>
    <label>目标仓库（owner/name）</label>
    <input type="text" id="repo" placeholder="EeroEternal/xgateway">
    <label>附加指令（每次运行都会带给 Agent）</label>
    <textarea id="extra" placeholder="例：优先关注 deploy 目录与 e2e 失败"></textarea>
    <div class="row">
      <div>
        <label><input type="checkbox" id="dailyEnabled"> 每日深度扫描（午夜 UTC）</label>
        <textarea id="dailyTask"></textarea>
      </div>
      <div>
        <label><input type="checkbox" id="quickEnabled"> 快速巡检（每 6 小时）</label>
        <textarea id="quickTask"></textarea>
      </div>
    </div>
    <button id="save">保存设置</button>
    <button class="ghost" id="runDaily">立即运行深度扫描</button>
    <button class="ghost" id="runQuick">立即运行快速巡检</button>
  </section>

  <section>
    <h2>与 Agent 对话</h2>
    <div id="chatlog"></div>
    <label>消息</label>
    <input type="text" id="chatInput" placeholder="例：看看最近 CI 有没有问题">
    <button id="send">发送</button>
    <div class="hint">对话是同一个长期会话（nightly），Agent 的记忆和 playbook 跨次延续。</div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const keyInput = $('apiKey');
keyInput.value = localStorage.getItem('bonsaiKey') || '';
keyInput.onchange = () => localStorage.setItem('bonsaiKey', keyInput.value.trim());

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + keyInput.value.trim(),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { status('密钥不对（401）'); return null; }
  if (res.status === 503) { status('服务端还没设置 KEEPER_API_KEY（503）'); return null; }
  return res.json();
}

async function loadConfig() {
  const c = await api('/api/config');
  if (!c) return;
  $('repo').value = c.repo || '';
  $('extra').value = c.extra || '';
  $('dailyEnabled').checked = !!c.daily.enabled;
  $('dailyTask').value = c.daily.task;
  $('quickEnabled').checked = !!c.quick.enabled;
  $('quickTask').value = c.quick.task;
}

$('save').onclick = async () => {
  const c = await api('/api/config', {
    method: 'PUT',
    body: {
      repo: $('repo').value.trim(),
      extra: $('extra').value,
      daily: { enabled: $('dailyEnabled').checked, task: $('dailyTask').value },
      quick: { enabled: $('quickEnabled').checked, task: $('quickTask').value },
    },
  });
  if (c) status('设置已保存 ✅');
};

const run = async (slot) => {
  const r = await api('/api/run', { method: 'POST', body: { slot } });
  if (r) status(slot === 'daily' ? '深度扫描已排队 ✅' : '快速巡检已排队 ✅');
};
$('runDaily').onclick = () => run('daily');
$('runQuick').onclick = () => run('quick');

function renderHistory(h) {
  const box = $('chatlog');
  box.innerHTML = '';
  for (const m of h.messages || []) {
    const text = (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\\n');
    if (!text.trim()) continue;
    const div = document.createElement('div');
    div.className = 'msg ' + m.role;
    div.innerHTML = '<b>' + (m.role === 'user' ? '你' : 'bonsai') + '</b> ' + text;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

async function refresh() {
  const h = await api('/agents/keeper/nightly?view=history');
  if (h) renderHistory(h);
}

$('send').onclick = async () => {
  const body = $('chatInput').value.trim();
  if (!body) return;
  $('chatInput').value = '';
  const r = await api('/agents/keeper/nightly', { method: 'POST', body: { kind: 'user', body } });
  if (!r) return;
  status('已发送，等待回复…');
  let tries = 0;
  const timer = setInterval(async () => {
    await refresh();
    if (++tries > 20) { clearInterval(timer); status(''); }
  }, 3000);
  setTimeout(() => status(''), 20000);
};
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('send').onclick(); });

loadConfig();
refresh();
</script>
</body>
</html>`;
