// 从 index.html 渲染「设计文档版」PDF 作品集
// 网页仍是唯一数据源：在浏览器 DOM 里按语义解析内容，重排成文档结构（封面/三支柱/案例/方法/背景/联系）
// 用法: NODE_PATH=/tmp/pf-verify/node_modules node make-pdf.js [输出路径]
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const WEB = path.join(ROOT, 'index.html');
const OUT = process.argv[2] || path.join(ROOT, '刘舒锐-AI产品经理作品集.pdf');
const CASE_KEYS = ['demand', 'recruit', 'novel', 'memoai'];
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Tailwind CDN 生效检测：未生效则刷新重试（CDN 偶发断连，重试可过）
  async function ensureTailwind() {
    for (let attempt = 1; attempt <= 6; attempt++) {
      const ok = await page.evaluate(() =>
        typeof window.tailwind !== 'undefined' &&
        (() => { const b = document.querySelector('.hero-badge'); return b && getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)'; })()
      ).catch(() => false);
      if (ok) return true;
      if (attempt > 1) await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(700 + attempt * 300);
    }
    return false;
  }

  // 拦截 Tailwind CDN 请求 → 用本地副本应答，渲染不再依赖网络
  await page.route('**/cdn.tailwindcss.com', route =>
    route.fulfill({ path: path.join(ROOT, 'vendor/tailwindcss.js'), contentType: 'application/javascript' })
  );

  await page.goto('file://' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const tailwindOk = await ensureTailwind();
  if (!tailwindOk) errors.push('Tailwind did not apply');
  await page.evaluate(() => document.fonts.ready).catch(() => {});

  // ============ 1. 浏览器内按语义解析网页内容 ============
  const data = await page.evaluate((keys) => {
    // ---- 通用工具 ----
    function cleanHTML(el) {
      // 去掉 Tailwind 工具类，只保留语义强调类（.num / .hl），避免网页样式泄漏进文档
      const c = el.cloneNode(true);
      c.querySelectorAll('*').forEach(n => {
        const cls = (n.getAttribute('class') || '').split(/\s+/).filter(x => x === 'num' || x === 'hl');
        if (cls.length) n.setAttribute('class', cls.join(' ')); else n.removeAttribute('class');
      });
      return c.innerHTML;
    }

    // 解析案例弹窗：顶层依次为 案头/角色/官网链接/主图/一句话框/分节(h4.section-h)
    function parseModal(root) {
      const out = { head: null, role: '', link: null, figs: [], box: null, sections: [] };
      const kids = Array.from(root.children);
      let i = 0;
      while (i < kids.length) {
        const el = kids[i];
        // 分节：h4 包在 wrapper 里（div.mb-6 > h4 + content）
        const h4 = el.querySelector ? el.querySelector('h4.section-h') : null;
        if (h4) {
          const title = h4.textContent.trim();
          const content = el.cloneNode(true);
          const h = content.querySelector('h4.section-h');
          if (h) h.remove();
          out.sections.push({ title, blocks: parseBlocks(content) });
          i++; continue;
        }
        // 分节：裸 h4 + 后续兄弟节点（"三个关键决策"/"我是怎么做的"）
        if (el.tagName === 'H4' && el.classList.contains('section-h')) {
          const title = el.textContent.trim();
          const content = document.createElement('div');
          let j = i + 1;
          while (j < kids.length) {
            const nx = kids[j];
            if (nx.tagName === 'H4' && nx.classList.contains('section-h')) break;
            if (nx.querySelector && nx.querySelector('h4.section-h')) break;
            content.appendChild(nx.cloneNode(true));
            j++;
          }
          out.sections.push({ title, blocks: parseBlocks(content) });
          i = j; continue;
        }
        // 案头
        if (el.querySelector && el.querySelector('h3') && el.querySelector('.badge')) {
          const h3 = el.querySelector('h3');
          const badge = el.querySelector('.badge');
          out.head = { title: h3.textContent.trim(), badge: badge.textContent.trim(), badgeClass: badge.className };
          i++; continue;
        }
        // 角色行 / 官网链接行
        if (el.tagName === 'P') {
          const a = el.querySelector('a');
          if (a) { out.link = { href: a.getAttribute('href'), text: a.textContent.trim() }; }
          else if (!out.role) { out.role = el.textContent.replace(/·\s*点击放大/g, '').trim(); }
          i++; continue;
        }
        // 主图（顶层 img + 下一条说明文字）
        if (el.tagName === 'IMG') {
          let cap = '';
          if (kids[i + 1] && kids[i + 1].tagName === 'P' && /主界面|截图|看板|示意|报告/.test(kids[i + 1].textContent)) {
            cap = kids[i + 1].textContent.replace(/·\s*点击放大/g, '').trim();
            i++;
          }
          out.figs.push({ src: el.getAttribute('src'), caption: cap || (el.getAttribute('alt') || '') });
          i++; continue;
        }
        // 一句话框
        if (el.getAttribute && /rgba\(29,58,95,\.06\)/.test(el.getAttribute('style') || '')) {
          out.box = cleanHTML(el);
          i++; continue;
        }
        i++;
      }
      return out;
    }

    function parseBlocks(container) {
      const blocks = [];
      Array.from(container.children).forEach(el => {
        // 指标卡
        const chips = Array.from(el.querySelectorAll ? (el.querySelectorAll('.metric-chip') || []) : []);
        if (chips.length) {
          blocks.push({ t: 'chips', items: chips.map(c => {
            const num = c.querySelector('.num');
            return { num: num ? num.textContent : '', text: c.textContent.replace(num ? num.textContent : '', '').trim() };
          }) });
          return;
        }
        // 决策块（span「决策 N」）——必须优先于 figs：决策容器内嵌图，先判决策再判图
        // 找「决策 N」span，向上爬到父级==块容器的决策卡（天然去重，不误伤包装层）
        const decSpans = Array.from(el.querySelectorAll ? el.querySelectorAll('span') : [])
          .filter(s => /^决策\s*\d/.test(s.textContent.trim()));
        if (decSpans.length) {
          const decs = decSpans.map(sp => {
            let d = sp;
            while (d.parentElement && d.parentElement !== el) d = d.parentElement;
            return d;
          }).filter((d, i, arr) => d && arr.indexOf(d) === i);
          blocks.push({ t: 'decs', decs: decs.map(d => {
            const span = d.querySelector('span');
            const num = span.textContent.trim();
            const title = span.parentElement && span.parentElement.querySelector('p') ? span.parentElement.querySelector('p').textContent.trim() : '';
            const qs = [];
            let label = null;
            Array.from(d.querySelectorAll('p')).forEach(p => {
              const t = p.textContent.trim();
              if (t === '问题' || t === '判断' || t === '取舍') { label = t; }
              else if (label) { qs.push({ label, html: cleanHTML(p) }); label = null; }
            });
            const dfigs = Array.from(d.querySelectorAll('figure')).map(f => {
              const fim = f.querySelector('img');
              return {
                src: fim ? fim.getAttribute('src') : '',
                caption: (f.querySelector('figcaption') ? f.querySelector('figcaption').textContent.trim() : '') || (fim ? (fim.getAttribute('alt') || '') : ''),
              };
            });
            return { num, title, qs, figs: dfigs };
          }) });
          return;
        }
        // 图（figure 组）
        const figs = Array.from(el.querySelectorAll ? (el.querySelectorAll('figure') || []) : []);
        if (figs.length) {
          blocks.push({ t: 'figs', figs: figs.map(f => {
            const fim = f.querySelector('img');
            return {
              src: fim ? fim.getAttribute('src') : '',
              caption: (f.querySelector('figcaption') ? f.querySelector('figcaption').textContent.trim() : '') || (fim ? (fim.getAttribute('alt') || '') : ''),
            };
          }) });
          return;
        }
        // 步骤
        const steps = Array.from(el.querySelectorAll ? (el.querySelectorAll('.step') || []) : []);
        if (steps.length) {
          blocks.push({ t: 'steps', steps: steps.map(s => {
            const ps = s.querySelectorAll('p');
            return { no: s.querySelector('.step-no') ? s.querySelector('.step-no').textContent.trim() : '',
                     title: ps[0] ? ps[0].textContent.trim() : '',
                     text: ps[1] ? ps[1].textContent.trim() : '' };
          }) });
          return;
        }
        // 裸图（结果证据里的 img）
        if (el.tagName === 'IMG') {
          blocks.push({ t: 'figs', figs: [{ src: el.getAttribute('src'), caption: el.getAttribute('alt') || '' }] });
          return;
        }
        // 纯文字
        if (el.tagName === 'P' || (el.querySelector && el.querySelector('p'))) {
          blocks.push({ t: 'text', html: cleanHTML(el) });
        }
      });
      return blocks;
    }

    // ---- 抓取页面各区 ----
    const q = s => { const el = document.querySelector(s); return el ? el.textContent.trim() : ''; };
    const hero = {
      tag: q('section.pt-36 .section-tag'),
      name: q('section.pt-36 h1'),
      line: (() => { const p = document.querySelector('section.pt-36 p.text-xl'); return p ? p.innerHTML : ''; })(),
      intro: q('section.pt-36 p.text-stone-500'),
      badges: Array.from(document.querySelectorAll('section.pt-36 .hero-badge')).map(b => b.textContent.trim()),
    };
    const value = Array.from(document.querySelectorAll('#value .value-card')).map(c => ({
      icon: c.querySelector('.value-icon').textContent.trim(),
      title: c.querySelector('h3').textContent.trim(),
      text: c.querySelector('p').textContent.trim(),
      tags: Array.from(c.querySelectorAll('.value-tags span')).map(s => s.textContent.trim()),
    }));
    const method = q('#method .section-sub');
    const about = Array.from(document.querySelectorAll('#about h4.section-h')).map(h => {
      // 取 h4 之后的第一个 p（不误抓父容器里更早的兄弟段落）
      let p = null;
      for (let n = h.nextSibling; n; n = n.nextSibling) {
        if (n.nodeType === 3 && n.textContent.trim()) continue;
        if (!n.querySelector) continue;
        p = n.tagName === 'P' ? n : n.querySelector('p');
        if (p) break;
      }
      return {
        title: h.textContent.trim(),
        text: p ? p.textContent.trim() : '',
        pills: Array.from(h.parentElement.querySelectorAll('.skill')).map(s => s.textContent.trim()),
      };
    });
    const contact = {
      headline: q('#cta h2'),
      sub: q('#cta p'),
      email: (() => { const a = document.querySelector('#cta a[href^="mailto:"]'); return a ? a.getAttribute('href').replace('mailto:', '') : ''; })(),
      wechat: (() => { const b = document.querySelector('#cta button'); return b ? b.textContent.replace('（点击复制）', '').trim() : ''; })(),
      github: (() => { const a = document.querySelector('#cta a[href*="github.com"]'); return a ? a.textContent.trim() : ''; })(),
    };

    // ---- 逐案例解析弹窗 ----
    const modal = document.querySelector('#modal');
    const cases = {};
    keys.forEach(k => {
      modal.classList.remove('show');
      document.body.style.overflow = '';
      openModal(k);
      cases[k] = parseModal(document.querySelector('#modalContent'));
      modal.classList.remove('show');
      document.body.style.overflow = '';
    });

    return { hero, value, method, about, contact, cases };
  }, CASE_KEYS);

  // 图片自然尺寸（纯 Node 读 PNG/JPEG 文件头，判断横竖：竖图两两拼一页，横图独占一页）
  const imageSize = file => {
    const b = fs.readFileSync(file);
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50) { // PNG
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    }
    if (b[0] === 0xFF && b[1] === 0xD8) { // JPEG
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        }
        if (i + 3 < b.length) i += 2 + b.readUInt16BE(i + 2); else i += 2;
      }
    }
    return { w: 0, h: 0 };
  };
  const dims = {};
  const dimSrc = f => {
    if (!f || !f.src || dims[f.src]) return;
    const p = path.join(ROOT, f.src);
    if (fs.existsSync(p)) dims[f.src] = imageSize(p);
  };
  CASE_KEYS.forEach(k => {
    const c = data.cases[k];
    c.figs.forEach(dimSrc);
    c.sections.forEach(s => s.blocks.forEach(b => {
      if (b.t === 'figs') b.figs.forEach(dimSrc);
      if (b.t === 'decs') b.decs.forEach(d => (d.figs || []).forEach(dimSrc));
    }));
  });

  // ============ 2. Node 组装设计文档 HTML ============
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 决策三问标签配色类：问题=琥珀 / 判断=深蓝 / 取舍=玫红，增强一页内的可视层级
  const qLabelCls = l => ({ '问题': 'problem', '判断': 'judge', '取舍': 'trade' })[l] || '';

  // 封面（简化：定位语 + 「AI 产品经理」+ 三能力词，去掉了 intro 方法论段落）
  const coverHtml = `
  <section class="doc-cover">
    <h1 class="cover-name">${esc(data.hero.name)}</h1>
    <p class="cover-role">AI Native 的产品经理</p>
    <p class="cover-line">${data.hero.line}</p>
    <div class="cover-badges">${data.hero.badges.map(b => `<span class="cover-badge">${esc(b)}</span>`).join('')}</div>
    <div class="cover-contact">
      <span>邮箱 · ${esc(data.contact.email)}</span>
      <span>${esc(data.contact.wechat)}</span>
      <span>${esc(data.contact.github)}</span>
    </div>
  </section>`;

  // 成绩 Dashboard（第二页，结果先打脸：三个硬数字 + 能力工具带）
  const dashHtml = `
  <section class="doc-dash">
    <div class="doc-sec-head">
      <span class="doc-tag">成绩</span>
      <h2 class="doc-title">我做成过什么</h2>
    </div>
    <div class="dash-grid">
      <div class="dash-card">
        <span class="dash-num">30+</span>
        <p class="dash-label">招聘自动化实际承接岗位</p>
        <p class="dash-sub">HR 前置筛选效率提升 100%+ · 入职率约 80%</p>
      </div>
      <div class="dash-card">
        <span class="dash-num">1 个月</span>
        <p class="dash-label">Demand Forecast AI</p>
        <p class="dash-sub">0 → MVP → 客户侧试用 → AppSource 上架审核</p>
      </div>
      <div class="dash-card">
        <span class="dash-num">+50%</span>
        <p class="dash-label">内容自动化产线</p>
        <p class="dash-sub">日均处理沟通量提升约 50%</p>
      </div>
    </div>
    <div class="dash-tools">
      <span>Agent</span><span>RPA</span><span>Excel Add-in</span><span>AI Coding</span>
    </div>
  </section>`;

  // 能力模型（第三页：这些结果背后的工作方式，复用 value 三卡 + 方法论行；CSS 复用 .doc-pillars）
  const abilityHtml = `
  <section class="doc-pillars">
    <div class="doc-sec-head">
      <span class="doc-tag">能力模型</span>
      <h2 class="doc-title">这些结果背后的工作方式</h2>
    </div>
    <div class="pillar-grid">
      ${data.value.map(v => `
      <div class="pillar-card">
        <div class="pillar-icon">${esc(v.icon)}</div>
        <h3>${esc(v.title)}</h3>
        <p>${esc(v.text)}</p>
        <div class="pillar-tags">${v.tags.map(t => `<span>${t}</span>`).join('')}</div>
      </div>`).join('')}
    </div>
    <div class="doc-method">
      <div class="doc-sec-head"><span class="doc-tag">方法论</span><h2 class="doc-title">我怎么判断</h2></div>
      <p class="doc-method-text">${esc(data.method)}</p>
    </div>
  </section>`;

  // 案例：图页 + 文字页分离——图绝不与项目文字混排。每张横图独占一页 A4（填满文字内容框、居中），
  // 两张竖图拼一页；每页带网页结构的上下文标签 + 图注，说明「这图表现了什么」
  const collectShots = c => {
    const shots = [];
    const push = (f, ctx) => { if (f && (f.src || f.caption)) shots.push({ src: f.src, caption: f.caption, ctx }); };
    // 主图（c.figs，案头下的首图）收进文字页标题下，不进图集页
    c.sections.forEach(s => {
      s.blocks.forEach(b => {
        if (b.t === 'figs') b.figs.forEach(f => push(f, s.title));
        if (b.t === 'decs') b.decs.forEach(d => {
          const ctx = `${s.title}${d.title ? ' · ' + d.title : ''}`;
          d.figs.forEach(f => push(f, ctx));
        });
      });
    });
    return shots;
  };
  const isPortrait = src => { const d = dims[src]; return !!(d && d.h > d.w); };
  const shotPageHtml = (soloOrPair) => {
    const items = Array.isArray(soloOrPair) ? soloOrPair : [soloOrPair];
    const ctx = items[0].ctx;
    return `
  <section class="doc-shot">
    <div class="doc-shot-head">
      ${ctx ? `<span class="doc-tag">${esc(ctx)}</span>` : ''}
      ${items.map(it => it.caption ? `<p class="doc-shot-cap">${esc(it.caption)}</p>` : '').join('')}
    </div>
    <div class="doc-shot-body${items.length === 2 ? ' doc-shot-pair' : ''}">
      ${items.map(it => `<img src="${esc(it.src)}" alt="">`).join('')}
    </div>
  </section>`;
  };
  const caseShotsHtml = (k) => {
    const c = data.cases[k];
    const shots = collectShots(c);
    if (!shots.length) return '';
    const out = [];
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (isPortrait(s.src) && i + 1 < shots.length && isPortrait(shots[i + 1].src)) {
        out.push(shotPageHtml([s, shots[++i]]));
      } else {
        out.push(shotPageHtml(s));
      }
    }
    return `
  <div class="doc-shots" data-case="${k}">
    ${out.join('')}
  </div>`;
  };
  // 图：单张全宽居中，成对并排（与网页 grid-cols-2 一致）；图紧贴它证明的论点，配图注
  const figSingleHtml = f => `
      <figure>
        <img src="${esc(f.src)}" alt="">
        ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
      </figure>`;
  const figsBlockHtml = (figs, headFirst) => {
    // headFirst：首图单张全宽、其余成对（网页决策2 = flow3 全宽 + workbench/report 并排）
    const out = [];
    let i = 0;
    if (headFirst && figs.length > 1) { out.push(`<div class="doc-fig-single">${figSingleHtml(figs[0])}</div>`); i = 1; }
    while (i < figs.length) {
      if (i + 1 < figs.length) {
        // 竖图对：紧贴居中 + 高度撑满（使用流程 flow/flow2）；横图对保持分栏并排
        const fill = isPortrait(figs[i].src) && isPortrait(figs[i + 1].src) ? ' doc-fig-row-fill' : '';
        out.push(`<div class="doc-fig-row${fill}">${figSingleHtml(figs[i])}${figSingleHtml(figs[i + 1])}</div>`);
        i += 2;
      } else {
        out.push(`<div class="doc-fig-single">${figSingleHtml(figs[i])}</div>`);
        i += 1;
      }
    }
    return out.join('');
  };
  // 指标卡（关键数据）——带节标题，供开场页底部带复用
  const chipsBlockHtml = (b, title) => `
    <div class="doc-chips">
      ${title ? `<span class="doc-chips-title">${esc(title)}</span>` : ''}
      ${b.items.map(c => `<span class="metric-chip"><span class="num">${esc(c.num)}</span> ${esc(c.text)}</span>`).join('')}
    </div>`;
  // 案例案头（各结果页复用：标题 + 徽章 + 角色/官网一行）
  const caseHeadHtml = (c) => {
    const badgeCls = c.head.badgeClass.includes('outline') ? 'badge-outline' : 'badge-solid';
    return `
      <div class="doc-case-head">
        <div class="doc-case-titlebar"><h3>${esc(c.head.title)}</h3><span class="badge ${badgeCls}">${esc(c.head.badge)}</span></div>
        ${(c.role || c.link) ? `<div class="doc-case-meta">${c.role ? `<span class="doc-case-role">${esc(c.role)}</span>` : ''}${c.link ? `<span class="doc-case-link"><a href="${esc(c.link.href)}">${esc(c.link.text)}</a></span>` : ''}</div>` : ''}
      </div>`;
  };
  // 图文混排：文字与图片块按网页顺序嵌在同一节里，图跟着它证明的论点走（不是图集页）
  const blockHtml = b => {
    switch (b.t) {
      case 'chips': return chipsBlockHtml(b, null);
      case 'figs': return figsBlockHtml(b.figs, false);
      case 'steps': return `<ol class="doc-steps">${b.steps.map(s => `<li><span class="doc-step-no">${esc(s.no)}</span><div class="doc-step-body"><strong>${esc(s.title)}</strong><p>${esc(s.text)}</p></div></li>`).join('')}</ol>`;
      // 决策：1/2/3 文字集中一页原子不拆；证据图独立成页，不与决策文字混排
      case 'decs': {
        const decsHtml = b.decs.map(d => `
          <div class="doc-dec">
            <div class="doc-dec-title"><span class="doc-dec-num">${esc(((d.num.match(/\d+/) || [])[0]) || d.num)}</span><strong>${esc(d.title)}</strong></div>
            ${d.qs.map(q => `<div class="doc-q"><span class="doc-q-label q-${qLabelCls(q.label)}">【${esc(q.label)}】</span><p>${q.html}</p></div>`).join('')}
          </div>`).join('');
        const evidDecs = b.decs.filter(d => d.figs && d.figs.length);
        const evidHtml = evidDecs.map(d => (d.figs || []).map((f, i) => `
            <div class="doc-ev-page">
              ${i === 0 ? `<span class="doc-fig-label">${esc(d.num)} · ${esc(d.title)}</span>` : ''}
              <div class="doc-ev-img">
                <figure>
                  <img src="${esc(f.src)}" alt="">
                  ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
                </figure>
              </div>
            </div>`).join('')).join('');
        return `
        <div class="doc-decs">${decsHtml}</div>
        ${evidDecs.length ? `<div class="doc-dec-evidence">${evidHtml}</div>` : ''}`;
      }
      case 'text': return `<p class="doc-p">${b.html}</p>`;
      default: return '';
    }
  };
  // ---------- Demand：结果先行，5 页（结果全貌 / 为什么难 / 三个决策 / 证据×2 / 阶段结果） ----------
  const demandHtml = () => {
    const c = data.cases.demand;
    const sec = t => c.sections.find(s => s.title.includes(t));
    const decs = (sec('决策') && sec('决策').blocks.find(b => b.t === 'decs')) || { decs: [] };
    const flowFigs = (sec('使用流程') && sec('使用流程').blocks.find(b => b.t === 'figs')) || { figs: [] };
    // 决策证据图：决策2（降维）的 flow3 + report
    const evidFigs = decs.decs.flatMap(d => d.figs || []).filter(f => f.src);
    // 决策对比行（✕/✓ 快速扫描）：与三个决策一一对应
    const DEC_CONTRAST = [
      { name: '聚焦', no: '完整供应链系统', yes: 'Excel 需求预测工具' },
      { name: '降维', no: '所有信息塞进工作台', yes: '操作与深读分层' },
      { name: '合规', no: '用客户数据训练模型', yes: '仅授权数据执行预测' },
    ];
    // 页面 1：结果 + 产品全貌
    const r1 = `
    <section class="doc-case doc-resultcase">
      <div class="doc-sec-head"><span class="doc-tag">Case 01 · Demand Forecast AI</span><h2 class="doc-title">结果 + 产品全貌</h2></div>
      ${caseHeadHtml(c)}
      <div class="result-cards">
        <div class="result-card"><span class="result-num">1 个月</span><p>0 → MVP</p></div>
        <div class="result-card"><span class="result-num">客户侧试用</span><p>真实历史销量数据跑通完整预测闭环</p></div>
        <div class="result-card"><span class="result-num">AppSource</span><p>已提交上架审核</p></div>
      </div>
      <div class="doc-mainimg">${c.figs.map(f => `
        <figure>
          <img src="${esc(f.src)}" alt="">
          ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
        </figure>`).join('')}</div>
    </section>`;
    // 页面 2：为什么难
    const r2 = `
    <section class="doc-case doc-challenge">
      <div class="doc-sec-head"><span class="doc-tag">Case 01 · Demand Forecast AI</span><h2 class="doc-title">为什么难</h2></div>
      <div class="challenge-chips">
        <span class="challenge-chip">多 SKU</span>
        <span class="challenge-chip">多维数据</span>
        <span class="challenge-chip">多算法</span>
        <span class="challenge-chip">Excel 空间有限</span>
        <span class="challenge-chip">普通用户 / 专家用户并存</span>
        <span class="challenge-chip">上架与数据隐私约束</span>
      </div>
      <p class="challenge-one">我的任务不是把算法搬进 Excel，而是把复杂性藏起来。</p>
      <div class="doc-chips"><span class="doc-chips-title">交付范围</span>
        <span class="metric-chip"><span class="num">6</span> 大典型场景 Benchmark</span>
        <span class="metric-chip"><span class="num">2</span> 层服务矩阵</span>
      </div>
    </section>`;
    // 页面 3：三个关键产品决策（01 聚焦 / 02 降维 / 03 合规，含 ✕/✓ 对比行）
    const r3 = `
    <section class="doc-case doc-decisions">
      <div class="doc-sec-head"><span class="doc-tag">Case 01 · Demand Forecast AI</span><h2 class="doc-title">三个关键产品决策</h2></div>
      <div class="doc-decs">
        ${decs.decs.map((d, i) => {
          const cmp = DEC_CONTRAST[i] || { name: '', no: '', yes: '' };
          const num = ((d.num.match(/\d+/) || [])[0]) || (i + 1);
          return `
        <div class="doc-dec">
          <div class="doc-dec-title"><span class="doc-dec-num">${esc(num)}</span><strong>${esc(cmp.name)}</strong><span class="doc-dec-sub">${esc(d.title)}</span></div>
          ${d.qs.filter(q => q.label !== '问题').map(q => `<div class="doc-q"><span class="doc-q-label q-${qLabelCls(q.label)}">【${esc(q.label)}】</span><p>${q.html}</p></div>`).join('')}
          <div class="dec-cmp">
            <span class="dec-cmp-item no"><span class="mark">✕</span>${esc(cmp.no)}</span>
            <span class="dec-cmp-item ok"><span class="mark">✓</span>${esc(cmp.yes)}</span>
          </div>
        </div>`;
        }).join('')}
      </div>
    </section>`;
    // 页面 4：证据 · 使用流程（flow + flow2 竖图对，整页铺满）
    const r4 = `
    <section class="doc-case doc-evidence">
      <div class="doc-sec-head"><span class="doc-tag">Case 01 · 证据</span><h2 class="doc-title">使用流程 · 把流程藏进 Excel</h2></div>
      <div class="doc-sec">
        <div class="doc-fig-row doc-fig-row-fill">${flowFigs.figs.map(f => `
          <figure>
            <img src="${esc(f.src)}" alt="">
            ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
          </figure>`).join('')}</div>
      </div>
    </section>`;
    // 页面 5：证据 · 降维（flow3 + report + 官网插图）
    const r5 = `
    <section class="doc-case doc-evidence">
      <div class="doc-sec-head"><span class="doc-tag">Case 01 · 证据</span><h2 class="doc-title">降维 · 判断不是嘴上说的</h2></div>
      <div class="doc-fig-row">${evidFigs.map(f => `
        <figure>
          <img src="${esc(f.src)}" alt="">
          ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
        </figure>`).join('')}</div>
      <div class="doc-fig-single"><figure><img src="images/官网插图.png" alt="插件官网"><figcaption>官网 · 我也负责搭建</figcaption></figure></div>
    </section>`;
    // 页面 6：阶段结果 + 下一步
    const r6 = `
    <section class="doc-case doc-stage">
      <div class="doc-sec-head"><span class="doc-tag">Case 01 · Demand Forecast AI</span><h2 class="doc-title">阶段结果 + 下一步</h2></div>
      <div class="doc-fig-single"><figure><img src="images/demand-result.png" alt="预测结果页"><figcaption>预测结果页</figcaption></figure></div>
      <h4 class="doc-sec-title">阶段结果</h4>
      <ul class="doc-stage-list">
        <li>1 个月完成 <strong>0 → MVP</strong></li>
        <li>客户真实历史销量数据跑通完整预测闭环</li>
        <li>客户侧试用，正在积累真实反馈</li>
        <li>已提交微软 <strong>AppSource</strong> 上架审核</li>
      </ul>
      <div class="doc-box"><strong>下一步：</strong>上架通过后先收集首批用户反馈，第一个迭代做 WPS 版本——国内办公生态绕不开 WPS。</div>
    </section>`;
    return r1 + r2 + r3 + r4 + r5 + r6;
  };

  // ---------- 招聘：结果先行，3 页（结果 / Before→After / 技术实现） ----------
  const recruitHtml = () => {
    const c = data.cases.recruit;
    const sec = t => c.sections.find(s => s.title.includes(t));
    const figsOf = t => (sec(t) && sec(t).blocks.find(b => b.t === 'figs')) || { figs: [] };
    const textOf = t => sec(t) && sec(t).blocks.find(b => b.t === 'text');
    const stepsOf = t => sec(t) && sec(t).blocks.find(b => b.t === 'steps');
    const baFigs = figsOf('Before').figs || [];
    const baText = textOf('Before');
    const review = textOf('复盘');
    // 页面 1：结果
    const r1 = `
    <section class="doc-case doc-resultcase">
      <div class="doc-sec-head"><span class="doc-tag">Case 02 · 智能招聘流程自动化</span><h2 class="doc-title">项目结果</h2></div>
      ${caseHeadHtml(c)}
      <div class="result-cards">
        <div class="result-card"><span class="result-num">30+</span><p>实际承接岗位需求</p></div>
        <div class="result-card"><span class="result-num">+100%</span><p>HR 前置筛选效率提升</p></div>
        <div class="result-card"><span class="result-num">≈80%</span><p>候选入职率</p></div>
      </div>
      <p class="doc-box">重构候选人筛选、触达与预沟通 Workflow，结合 Agent + RPA 实际承接 30+ 岗位需求，HR 前置筛选效率提升 100%+。</p>
      <div class="doc-mainimg">${c.figs.map(f => `
        <figure>
          <img src="${esc(f.src)}" alt="">
          ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
        </figure>`).join('')}</div>
    </section>`;
    // 页面 2：Before → After
    const r2 = `
    <section class="doc-case doc-beforeafter">
      <div class="doc-sec-head"><span class="doc-tag">Case 02 · 智能招聘流程自动化</span><h2 class="doc-title">Before → After</h2></div>
      <div class="doc-fig-row">${baFigs.map(f => `
        <figure>
          <img src="${esc(f.src)}" alt="">
          ${f.caption ? `<figcaption>${esc(f.caption)}</figcaption>` : ''}
        </figure>`).join('')}</div>
      ${baText ? `<div class="doc-box doc-ba-text">${baText.html}</div>` : ''}
    </section>`;
    // 页面 3：技术实现 + 为什么保留 HR 判断
    const r3 = `
    <section class="doc-case doc-tech">
      <div class="doc-sec-head"><span class="doc-tag">Case 02 · 智能招聘流程自动化</span><h2 class="doc-title">技术实现 + 为什么保留 HR 判断</h2></div>
      ${stepsOf('我是怎么做的') ? `<h4 class="doc-sec-title">我是怎么做的</h4>${blockHtml(stepsOf('我是怎么做的'))}` : ''}
      ${review ? `<h4 class="doc-sec-title">复盘 · Human-in-the-loop</h4><p class="doc-p">${review.html}</p>` : ''}
    </section>`;
    return r1 + r2 + r3;
  };

  // ---------- 更多实践：小说 + MemoAI 一页两栏 ----------
  const moreHtml = () => {
    const novel = data.cases.novel, memo = data.cases.memoai;
    const fig = c => (c.figs[0] || { src: '', caption: '' });
    return `
    <section class="doc-case doc-more">
      <div class="doc-sec-head"><span class="doc-tag">更多实践</span><h2 class="doc-title">还有更多落地能力</h2></div>
      <div class="more-grid">
        <div class="more-card">
          <div class="more-head"><h3>${esc(novel.head.title)}</h3><span class="more-num">+50% 日均处理量</span></div>
          <p class="more-line"><strong>挑战：</strong>AIGC 小说靠人工逐平台分发，产量上来后处理不动。</p>
          <p class="more-line"><strong>方案：</strong>QQ 多账号 RPA 状态机并行分发，全自动闭环。</p>
          <figure><img src="${esc(fig(novel).src)}" alt=""><figcaption>产线看板</figcaption></figure>
        </div>
        <div class="more-card">
          <div class="more-head"><h3>${esc(memo.head.title)}</h3><span class="more-num">MVP 已跑通</span></div>
          <p class="more-line"><strong>挑战：</strong>ADHD 场景「记录即流失」，记录摩擦要降到接近零。</p>
          <p class="more-line"><strong>方案：</strong>规则引擎兜底 + LLM 增强，全栈 AI Coding 独立实现。</p>
          <figure><img src="${esc(fig(memo).src)}" alt=""><figcaption>界面示意</figcaption></figure>
        </div>
      </div>
    </section>`;
  };

  // 背景 + 联系（合并一页，底部联系行）
  const aboutContactHtml = `
  <section class="doc-about doc-about-contact">
    <div class="doc-sec-head"><span class="doc-tag">背景</span><h2 class="doc-title">背景与能力</h2></div>
    ${data.about.map(a => `
    <div class="doc-about-block">
      <h4>${esc(a.title)}</h4>
      ${a.text ? `<p>${esc(a.text)}</p>` : ''}
      ${a.pills.length ? `<div class="doc-pills">${a.pills.map(p => `<span>${esc(p)}</span>`).join('')}</div>` : ''}
    </div>`).join('')}
    <div class="doc-contact-row">
      <span>邮箱 · ${esc(data.contact.email)}</span>
      <span>${esc(data.contact.wechat)}</span>
      <span>${esc(data.contact.github)}</span>
    </div>
  </section>`;

  // 我的工作模式（AI-native：标题 + 流程图 + 三栏说明，独立一页）
  const workmodeHtml = `
  <section class="doc-workmode">
    <div class="doc-sec-head"><span class="doc-tag">我的工作模式</span><h2 class="doc-title">AI 加速执行，我保留判断。</h2></div>
    <div class="doc-workmode-fig"><figure><img src="images/ai-native-workflow.png" alt="AI-native 工作方式：AI 加速执行，我负责判断与最终决策"></figure></div>
    <div class="doc-workmode-cols">
      <div class="doc-workmode-col"><h5>产品设计</h5><p>Claude Code + Skills 辅助 PRD 初稿，我完成规则判断与修改。</p></div>
      <div class="doc-workmode-col"><h5>原型验证</h5><p>AI Coding 快速搭 Demo，用运行结果验证交互与技术边界，再与开发沟通。</p></div>
      <div class="doc-workmode-col"><h5>自动化 Workflow</h5><p>岗位抓取 → 简历 Skills 微调 → 自动填表上传 → 我确认并点击投递。</p></div>
    </div>
  </section>`;

  const docHtml = `<div id="pdfdoc">${coverHtml}${dashHtml}${abilityHtml}${demandHtml()}${recruitHtml()}${workmodeHtml}${moreHtml()}${aboutContactHtml}<div class="doc-footer">刘舒锐 · AI 产品经理作品集</div></div>`;

  // 打印样式
  const printCss = `
  @media print {
    html, body { background: #fcfbf9 !important; }
    /* 全出血纸色：Chromium 无法给页边距上底色，用 margin:0 + padding 每页克隆实现「全页纸色」 */
    @page { size: A4 landscape; margin: 0; }
    body > *:not(#pdfdoc) { display: none !important; }
    #pdfdoc { display: block !important; font-family: 'Noto Sans SC', system-ui, sans-serif; color: #1a1a1a; font-size: 14.5px; line-height: 1.85; -webkit-print-color-adjust: exact; padding: 14mm 14mm 0; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .doc-footer { position: fixed; bottom: 7mm; left: 0; right: 0; text-align: center; font-size: 9px; color: #8b857b; font-family: 'Noto Sans SC', sans-serif; }
    #pdfdoc .hl { background: none !important; -webkit-text-fill-color: #1d3a5f !important; color: #1d3a5f !important; }

    /* ---- 封面（横版垂直居中） ---- */
    .doc-cover { page-break-after: always; text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .cover-name { font-size: 44px; font-weight: 800; letter-spacing: .08em; line-height: 1.45; margin-bottom: 18px; }
    .cover-line { font-size: 19px; font-weight: 600; color: #334155; line-height: 1.8; margin-bottom: 24px; }
    .cover-badges { display: flex; gap: 12px; justify-content: center; margin-bottom: 26px; }
    .cover-badge { border: 1px solid #e7e2da; border-radius: 9999px; padding: 6px 14px; font-size: 13px; color: #334155; background: #fff; }
    .cover-intro { max-width: 180mm; margin: 0 auto 30px; color: #57534e; font-size: 18px; line-height: 1.9; }
    .cover-contact { display: flex; gap: 20px; justify-content: center; font-size: 14px; color: #57534e; }

    /* ---- 通用标题（统一居中，PPT 式） ---- */
    .doc-sec-head { text-align: left; margin-bottom: 16px; }
    .doc-tag { display: inline-block; font-size: 13px; font-weight: 700; color: #1d3a5f; background: rgba(29,58,95,.08); border: 1px solid rgba(29,58,95,.22); padding: 4px 14px; border-radius: 9999px; margin-bottom: 10px; }
    .doc-title { font-size: 24px; font-weight: 700; margin: 0; }

    /* ---- 三支柱 + 方法（第二页垂直居中填满） ---- */
    .doc-pillars { page-break-after: always; display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .pillar-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
    .pillar-card { border: 1px solid #e7e2da; border-radius: 14px; padding: 30px 24px; display: flex; flex-direction: column; page-break-inside: avoid; min-height: 320px; }
    .pillar-icon { width: 52px; height: 52px; border-radius: 12px; background: rgba(29,58,95,.08); color: #1d3a5f; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; margin-bottom: 18px; }
    .pillar-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 12px; }
    .pillar-card p { font-size: 13px; color: #57534e; line-height: 1.9; flex: 1; }
    .pillar-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .pillar-tags span { font-size: 13px; font-weight: 600; color: #1d3a5f; background: rgba(29,58,95,.07); border: 1px solid rgba(29,58,95,.2); padding: 5px 11px; border-radius: 9999px; }
    .doc-method { margin-top: 44px; text-align: left; page-break-inside: avoid; }
    .doc-method .doc-sec-head { margin-bottom: 14px; }
    .doc-method-text { font-size: 15px; color: #44403c; line-height: 2.0; max-width: 210mm; margin: 0; }

    /* ---- 案例 ---- */
    .doc-case { page-break-before: always; }
    /* 正文与开场页（案头+主图）分开：开场页=标题+主图+一句话，正文单独一页 */
    .doc-sections { page-break-before: always; }
    .doc-case-head { border-bottom: 2px solid #1d3a5f; padding-bottom: 4px; margin-bottom: 14px; }
    .doc-case-titlebar { display: flex; align-items: center; justify-content: flex-start; gap: 12px; }
    .doc-case-titlebar h3 { font-size: 21px; font-weight: 700; line-height: 1.3; margin: 0; }
    .badge { display: inline-block; font-size: 13px; font-weight: 600; padding: 3px 12px; border-radius: 9999px; }
    .badge-solid { background: #1d3a5f; color: #fff; }
    .badge-outline { border: 1px solid #1d3a5f; color: #1d3a5f; }
    .doc-case-meta { display: flex; flex-wrap: wrap; gap: 4px 20px; align-items: baseline; margin-top: 3px; }
    .doc-case-role { font-size: 13px; color: #57534e; }
    .doc-case-link a { color: #1d3a5f; font-size: 13px; font-weight: 600; text-decoration: none; }
    /* 摘要页 = 案头 + 主图铺满剩余高度（flex 撑满整页，图适配到最大尺寸）+ 一句话 */
    .doc-opener { display: flex; flex-direction: column; min-height: 182mm; }
    .doc-mainimg { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 2px 0 2px; page-break-inside: avoid; }
    /* 开场页底部：一句话框下方堆关键数据指标卡（用户「放到一句话下面」）——标签行内缩空间保主图高度 */
    .doc-chips-block { margin-bottom: 2px; }
    .doc-opener .doc-box { padding: 8px 14px; margin-bottom: 5px; }
    .doc-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; justify-content: center; margin-bottom: 4px; }
    .doc-chips-title { display: inline-block; font-size: 13px; font-weight: 700; color: #1d3a5f; letter-spacing: .04em; margin-right: 6px; }
    .doc-mainimg figure { margin: 0; height: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .doc-mainimg img { max-width: 100%; max-height: calc(100% - 34px); height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .doc-mainimg figcaption { font-size: 13px; font-weight: 600; color: #44403c; margin-top: 5px; }

    /* 嵌入正文的图：单张全宽居中、成对并排，图不跨页断行 */
    .doc-fig-single { text-align: center; margin: 10px 0; page-break-inside: avoid; }
    /* figure 用 flex 居中：Tailwind Preflight 把 img 置为 block，text-align 对块级 img 无效，块级图靠 align-items:center 才能水平居中 */
    .doc-fig-single figure { margin: 0; display: flex; flex-direction: column; align-items: center; }
    .doc-fig-single img { max-width: 94%; max-height: 390px; height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .doc-fig-row { display: flex; gap: 16px; align-items: center; margin: 10px 0; page-break-inside: avoid; }
    .doc-fig-row figure { flex: 1 1 0; min-width: 0; margin: 0; display: flex; flex-direction: column; align-items: center; }
    .doc-fig-row img { max-width: 100%; max-height: 390px; height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    /* 竖图对（使用流程 flow/flow2）：两张紧贴、整体居中、高度撑满 */
    .doc-fig-row-fill { justify-content: center; gap: 10px; }
    .doc-fig-row-fill figure { flex: 0 0 auto; }
    .doc-fig-row-fill img { max-height: 575px; }
    /* 使用流程竖图对所在节：整节占满一页并垂直居中（修下方留白 > 上方）。:has 仅命中含竖图对行的节（唯一使用处 = demand 使用流程） */
    .doc-sec:has(.doc-fig-row-fill) { min-height: 182mm; margin-bottom: 0; display: flex; flex-direction: column; justify-content: center; }
    .doc-fig-single figcaption, .doc-fig-row figcaption { font-size: 13px; font-weight: 600; color: #44403c; margin-top: 6px; }

    .doc-sec { margin-bottom: 15px; }
    .doc-sec-title { font-size: 18px; font-weight: 700; color: #1d3a5f; letter-spacing: .05em; margin: 14px 0 9px; page-break-after: avoid; text-align: left; }
    .doc-box { background: rgba(29,58,95,.06); border: 1px solid rgba(29,58,95,.15); border-radius: 10px; padding: 9px 14px; margin-bottom: 10px; font-size: 14.5px; line-height: 1.7; color: #1a1a1a; }

    /* 官网页：官网截图单独一页 + 网址 */
    .doc-website { page-break-before: always; display: flex; flex-direction: column; min-height: 182mm; }
    .doc-website-head { text-align: center; margin-bottom: 6px; }
    .doc-website-head .doc-tag { margin-bottom: 4px; }
    .doc-website-url { text-align: center; font-size: 14px; font-weight: 600; color: #1d3a5f; margin: 10px 0 0; }
    .doc-website-url a { color: #1d3a5f; text-decoration: none; }
    .doc-website-body { flex: 1 1 0; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .doc-website-body figure { margin: 0; max-width: 100%; max-height: 100%; }
    .doc-website-body img { max-width: 100%; max-height: 100%; height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .doc-p { margin: 0 0 10px; color: #44403c; font-size: 14.5px; }
    .doc-box p, .doc-q p { margin: 0; }

    /* 指标卡 */
    .doc-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; align-content: center; justify-content: center; }
    .metric-chip { display: inline-flex; align-items: baseline; gap: 3px; font-size: 13px; color: #44403c; background: #fff; border: 1px solid #e7e2da; border-radius: 9999px; padding: 5px 12px; white-space: nowrap; }
    .metric-chip .num { font-weight: 700; color: #1d3a5f; font-size: 1.2em; }

    /* 图页：一张横图独占一页 A4，两张竖图拼一页。图适配到文字内容框最大尺寸、上下左右居中 */
    .doc-shot { page-break-before: always; min-height: 182mm; display: flex; flex-direction: column; }
    .doc-shot-head { text-align: center; margin-bottom: 12px; }
    .doc-shot-head .doc-tag { margin-bottom: 6px; }
    .doc-shot-cap { font-size: 13px; font-weight: 600; color: #44403c; margin: 3px 0 0; }
    .doc-shot-body { flex: 1 1 0; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .doc-shot-body.doc-shot-pair { gap: 22px; }
    .doc-shot-body img { max-width: 100%; max-height: 100%; height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .doc-shot-pair img { max-width: 50%; }

    /* 步骤（1/2/3/4 连在一起，不拆页） */
    .doc-steps { list-style: none; margin: 0; padding: 0; page-break-inside: avoid; }
    .doc-steps li { display: flex; gap: 13px; margin-bottom: 10px; page-break-inside: avoid; }
    .doc-step-no { flex: 0 0 25px; height: 25px; border-radius: 9999px; background: #1d3a5f; color: #fff; font-size: 13.5px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; margin-top: 2px; }
    .doc-step-body strong { display: block; font-size: 16.5px; margin-bottom: 4px; }
    .doc-step-body p { margin: 0; font-size: 14.5px; color: #44403c; }

    /* 决策（1/2/3 文字集中一页原子不拆；证据图独立成页，不与决策文字混排） */
    .doc-decs { page-break-inside: avoid; }
    .doc-dec { margin-bottom: 5px; padding: 5px 12px 5px; background: #fff; border: 1px solid #e7e2da; border-left: 3px solid #1d3a5f; border-radius: 8px; page-break-inside: avoid; }
    .doc-dec-title { display: flex; align-items: center; gap: 9px; margin-bottom: 3px; page-break-after: avoid; }
    .doc-dec-num { flex: 0 0 24px; width: 24px; height: 24px; border-radius: 50%; background: #1d3a5f; color: #fff; font-size: 13px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
    .doc-dec-title strong { font-size: 16.5px; }
    .doc-q { margin-bottom: 2px; }
    .doc-q-label { display: inline-block; font-size: 13px; font-weight: 700; margin-bottom: 1px; }
    .doc-q-label.q-problem { color: #b45309; }
    .doc-q-label.q-judge { color: #1d3a5f; }
    .doc-q-label.q-trade { color: #9f1239; }
    .doc-q p { font-size: 14px; color: #44403c; line-height: 1.7; }
    /* 决策证据图：每张证据图各自独占一页（.doc-ev-page），标签只随首图，图片在整页剩余空间垂直居中并放到最大 */
    .doc-dec-evidence { page-break-before: always; }
    .doc-dec-evidence > .doc-ev-page:first-child { page-break-before: auto; }
    .doc-ev-page { page-break-before: always; min-height: 182mm; display: flex; flex-direction: column; page-break-inside: avoid; }
    .doc-fig-label { display: block; text-align: center; font-size: 13px; font-weight: 700; color: #1d3a5f; margin-bottom: 8px; }
    .doc-ev-img { flex: 1 1 0; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .doc-ev-img figure { margin: 0; height: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .doc-ev-img img { max-width: 100%; max-height: 620px; height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .doc-ev-img figcaption { font-size: 13px; font-weight: 600; color: #44403c; margin-top: 6px; }

    /* 方法 / 背景 */
    .doc-about { margin-top: 26px; page-break-before: always; }
    .doc-about-block { margin-bottom: 14px; page-break-inside: avoid; }
    .doc-about-block h4 { font-size: 15px; font-weight: 700; color: #1d3a5f; margin: 0 0 6px; }
    .doc-about-block p { margin: 0 0 8px; color: #44403c; }
    .doc-pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .doc-pills span { font-size: 13px; font-weight: 600; color: #1d3a5f; background: rgba(29,58,95,.07); border: 1px solid rgba(29,58,95,.2); padding: 4px 11px; border-radius: 9999px; }

    /* 联系（整页垂直居中的收尾页，标题保持居中与封面呼应） */
    .doc-contact { text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 182mm; page-break-inside: avoid; }
    .doc-contact .doc-sec-head { text-align: center; }
    .doc-contact-sub { color: #57534e; margin: 0 0 26px; }
    .doc-contact-row { display: flex; gap: 14px; justify-content: center; }
    .doc-contact-row span { border: 1px solid #e7e2da; border-radius: 9999px; padding: 8px 18px; font-size: 13px; color: #1d3a5f; background: #fff; }

    /* 我的工作模式：标题固定顶部、流程图占满中部、三栏说明在底部，整页居中填满 */
    .doc-workmode { page-break-before: always; display: flex; flex-direction: column; min-height: 182mm; text-align: center; }
    .doc-workmode .doc-sec-head { text-align: center; }
    .doc-workmode .doc-sec-head { flex: 0 0 auto; }
    .doc-workmode-fig { flex: 1 1 0; min-height: 0; display: flex; align-items: center; justify-content: center; margin: 4px 0 12px; page-break-inside: avoid; }
    .doc-workmode-fig figure { margin: 0; height: 100%; max-width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .doc-workmode-fig img { max-width: 100%; max-height: calc(100% - 4px); height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .doc-workmode-cols { flex: 0 0 auto; display: flex; gap: 16px; max-width: 236mm; margin: 0 auto 2px; text-align: left; }
    .doc-workmode-col { flex: 1 1 0; border: 1px solid #e7e2da; border-radius: 10px; background: #fff; padding: 12px 16px; }
    .doc-workmode-col h5 { font-size: 15px; font-weight: 700; color: #1d3a5f; margin: 0 0 5px; }
    .doc-workmode-col p { font-size: 13.5px; color: #44403c; line-height: 1.75; margin: 0; }

    /* ---- 成绩 Dashboard（第二页，结果先打脸：三个大数字卡 + 工具带） ---- */
    .doc-dash { page-break-after: always; display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .dash-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin: 20px 0 34px; }
    .dash-card { border: 1px solid #e7e2da; border-radius: 14px; background: #fff; padding: 32px 24px; text-align: center; page-break-inside: avoid; }
    .dash-num { display: block; font-size: 40px; font-weight: 800; color: #1d3a5f; line-height: 1.25; letter-spacing: .02em; }
    .dash-label { margin: 12px 0 0; font-size: 15px; font-weight: 700; color: #1a1a1a; }
    .dash-sub { margin: 6px 0 0; font-size: 13px; color: #57534e; line-height: 1.8; }
    .dash-tools { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .dash-tools span { font-size: 13px; font-weight: 600; color: #1d3a5f; background: rgba(29,58,95,.07); border: 1px solid rgba(29,58,95,.2); padding: 6px 16px; border-radius: 9999px; }

    /* ---- 封面副标题（AI 产品经理） ---- */
    .cover-role { font-size: 16px; font-weight: 600; color: #1d3a5f; letter-spacing: .28em; margin: 0 0 16px; }

    /* ---- 案例结果页（案头 + 结果卡 + 主图铺满剩余高度） ---- */
    .doc-resultcase { display: flex; flex-direction: column; min-height: 182mm; }
    .result-cards { display: flex; gap: 14px; margin: 12px 0 6px; }
    .result-card { flex: 1; background: #fff; border: 1px solid #e7e2da; border-radius: 12px; padding: 16px 12px; text-align: center; page-break-inside: avoid; }
    .result-num { display: block; font-size: 26px; font-weight: 800; color: #1d3a5f; line-height: 1.25; }
    .result-card p { margin: 6px 0 0; font-size: 13px; color: #44403c; line-height: 1.6; }

    /* ---- 为什么难（挑战 chips + 一句定性） ---- */
    .doc-challenge { display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .challenge-chips { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-bottom: 30px; }
    .challenge-chip { font-size: 15px; font-weight: 600; color: #1a1a1a; background: #fff; border: 1px solid #e7e2da; border-radius: 9999px; padding: 9px 20px; }
    .challenge-one { font-size: 20px; font-weight: 700; color: #1d3a5f; text-align: center; max-width: 200mm; margin: 0 auto 26px; line-height: 1.8; }
    .doc-challenge .doc-chips { justify-content: center; margin-bottom: 0; }

    /* ---- 三个关键产品决策（含 ✕/✓ 对比行，整页垂直居中） ---- */
    .doc-decisions { display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .doc-decisions .doc-dec { padding: 4px 10px; margin-bottom: 4px; }
    .doc-decisions .doc-dec-title { margin-bottom: 2px; }
    .doc-decisions .doc-dec-title strong { font-size: 15.5px; }
    .doc-dec-sub { font-size: 12.5px; color: #57534e; margin-left: 2px; }
    .doc-decisions .doc-q p { font-size: 13px; line-height: 1.6; }
    .doc-decisions .dec-cmp { margin-top: 4px; }
    .dec-cmp { display: flex; gap: 8px; margin-top: 6px; }
    .dec-cmp-item { flex: 1; font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 6px; }
    .dec-cmp-item .mark { font-weight: 800; margin-right: 6px; }
    .dec-cmp-item.no { background: rgba(185,28,28,.06); color: #b91c1c; border: 1px solid rgba(185,28,28,.25); }
    .dec-cmp-item.ok { background: rgba(21,128,61,.06); color: #15803d; border: 1px solid rgba(21,128,61,.25); }

    /* ---- 证据页（标题固定顶部，图占满中部） ---- */
    .doc-evidence { display: flex; flex-direction: column; min-height: 182mm; }
    .doc-evidence .doc-sec-head { flex: 0 0 auto; margin-bottom: 10px; }
    .doc-evidence .doc-sec { flex: 1 1 0; min-height: 0; margin: 0; }
    .doc-evidence .doc-fig-row { flex: 1 1 0; min-height: 0; margin: 0; align-items: center; }
    .doc-evidence .doc-fig-row img { max-height: 300px; }
    .doc-evidence .doc-fig-row.doc-fig-row-fill { flex: 1 1 0; min-height: 0; justify-content: center; gap: 10px; align-items: center; }
    .doc-evidence .doc-fig-row.doc-fig-row-fill figure { flex: 0 0 auto; }
    .doc-evidence .doc-fig-row.doc-fig-row-fill img { max-height: 535px; }
    .doc-evidence .doc-fig-single { flex: 0 0 auto; margin: 4px 0 0; }
    .doc-evidence .doc-fig-single img { max-height: 235px; max-width: 90%; }

    /* ---- 阶段结果 + 下一步 ---- */
    .doc-stage { display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .doc-stage .doc-fig-single { margin: 4px 0 2px; }
    .doc-stage .doc-fig-single img { max-height: 300px; }
    .doc-stage .doc-sec-title { margin: 10px 0 7px; }
    .doc-stage-list { list-style: none; margin: 0 0 10px; padding: 0; page-break-inside: avoid; }
    .doc-stage-list li { display: flex; align-items: baseline; gap: 10px; font-size: 14px; color: #1a1a1a; margin-bottom: 5px; }
    .doc-stage-list li::before { content: ""; flex: 0 0 7px; height: 7px; border-radius: 50%; background: #1d3a5f; align-self: center; }

    /* ---- 招聘：Before→After / 技术实现 ---- */
    .doc-beforeafter, .doc-tech { display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }

    /* ---- 更多实践（两栏卡） ---- */
    .doc-more { display: flex; flex-direction: column; justify-content: center; min-height: 182mm; }
    .more-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px; }
    .more-card { border: 1px solid #e7e2da; border-radius: 14px; background: #fff; padding: 22px 20px; display: flex; flex-direction: column; page-break-inside: avoid; }
    .more-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .more-head h3 { font-size: 18px; font-weight: 700; margin: 0; }
    .more-num { font-size: 13px; font-weight: 700; color: #1d3a5f; background: rgba(29,58,95,.08); border: 1px solid rgba(29,58,95,.2); padding: 4px 12px; border-radius: 9999px; white-space: nowrap; }
    .more-line { margin: 0 0 8px; font-size: 13.5px; color: #44403c; line-height: 1.75; }
    .more-card figure { margin: 12px 0 0; display: flex; flex-direction: column; align-items: center; }
    .more-card img { max-width: 100%; max-height: 210px; height: auto; border: 1px solid #e7e2da; border-radius: 6px; }
    .more-card figcaption { font-size: 12.5px; font-weight: 600; color: #44403c; margin-top: 6px; }

    /* ---- 背景 + 联系合并 ---- */
    .doc-about-contact { min-height: 182mm; display: flex; flex-direction: column; justify-content: center; }
    .doc-about-contact .doc-contact-row { margin-top: 30px; }
  }
  @media screen { #pdfdoc { display: none; } }
  `;

  // ============ 3. 注入文档 + 打印样式 ============
  await page.evaluate(({ docHtml, printCss }) => {
    document.body.insertAdjacentHTML('beforeend', docHtml);
    const style = document.createElement('style');
    style.textContent = printCss;
    document.head.appendChild(style);
  }, { docHtml, printCss });

  // 图片加载检查
  await page.waitForTimeout(400);
  const imgOk = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('#pdfdoc img'));
    return { total: imgs.length, bad: imgs.filter(i => !(i.complete && i.naturalWidth > 0)).map(i => i.getAttribute('src')) };
  });
  if (imgOk.bad.length) errors.push('images not loaded: ' + imgOk.bad.join(','));

  // 打印版面测量：各区块所在页 + 每页覆盖率（找近空白页）
  await page.emulateMedia({ media: 'print' });
  const layout = await page.evaluate(() => {
    const pagePx = 688; // 横版 A4 高210mm - 上下边距28mm = 182mm ≈ 688 打印px（1css px = 1/96in）
    const blocks = [];
    const push = (el, name) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      blocks.push({ name, top: Math.round(rect.top + window.scrollY), h: Math.round(rect.height) });
    };
    push(document.querySelector('.doc-cover'), 'cover');
    push(document.querySelector('.doc-dash'), 'dash');
    push(document.querySelector('.doc-pillars'), 'pillars');
    document.querySelectorAll('.doc-case').forEach((el, i) => push(el, 'case' + (i + 1)));
    push(document.querySelector('.doc-method'), 'method');
    push(document.querySelector('.doc-about'), 'about');
    const totalH = document.documentElement.scrollHeight;
    const totalPages = Math.ceil(totalH / pagePx);
    const cover = new Array(totalPages).fill(0);
    blocks.forEach(b => {
      const s = Math.floor(b.top / pagePx), e = Math.floor((b.top + b.h) / pagePx);
      for (let p = s; p <= e; p++) if (p >= 0 && p < totalPages) cover[p] += Math.min(b.h, 700);
    });
    const blockPages = blocks.map(b => `${b.name}:p${Math.floor(b.top / pagePx) + 1}(h${b.h})`);
    // 摘要页主图实际渲染尺寸（诊断：是否铺满容器）
    const mainimgs = Array.from(document.querySelectorAll('.doc-mainimg')).map(el => {
      const img = el.querySelector('img'); const r = img.getBoundingClientRect(); const c = el.getBoundingClientRect();
      const fig = img.closest('figure'); const fr = fig ? fig.getBoundingClientRect() : null;
      const op = el.closest('.doc-opener'); const or = op ? op.getBoundingClientRect() : null;
      return { src: img.getAttribute('src').split('/').pop(), w: Math.round(r.width), h: Math.round(r.height), boxH: Math.round(c.height), mainW: Math.round(c.width), figW: fr ? Math.round(fr.width) : 0, openerW: or ? Math.round(or.width) : 0, fill: Math.round(100 * r.height / c.height) };
    });
    const openerInfo = Array.from(document.querySelectorAll('.doc-opener')).map(op => {
      const kids = Array.from(op.children).map(k => ({ cls: k.className, h: Math.round(k.getBoundingClientRect().height), mb: parseFloat(getComputedStyle(k).marginBottom) }));
      const mi = op.querySelector('.doc-mainimg');
      return { kids, miH: mi ? Math.round(mi.getBoundingClientRect().height) : 0, openerH: Math.round(op.getBoundingClientRect().height) };
    });
    const evidImgs = Array.from(document.querySelectorAll('.doc-dec-evidence img')).map(img => {
      const r = img.getBoundingClientRect();
      return { src: img.getAttribute('src').split('/').pop(), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const headGap = sel => Array.from(document.querySelectorAll(sel)).map(c => {
      const head = c.querySelector('.doc-case-head, .doc-fig-label, .doc-shot-head, .doc-website-head');
      const img = c.querySelector('img');
      if (!head || !img) return null;
      const hr = head.getBoundingClientRect(), ir = img.getBoundingClientRect();
      return { sel, gap: Math.round(ir.top - hr.bottom), headBot: Math.round(hr.bottom), imgTop: Math.round(ir.top) };
    }).filter(Boolean);
    const openerGaps = [...headGap('.doc-opener'), ...headGap('.doc-dec-evidence'), ...headGap('.doc-shot'), ...headGap('.doc-website')];
    const cap = sel => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontSize : null; };
    const captionSizes = { figRow: cap('.doc-fig-row figcaption'), mainimg: cap('.doc-mainimg figcaption'), chipsTitle: cap('.doc-chips-title'), figLabel: cap('.doc-fig-label'), coverIntro: cap('.cover-intro'), coverContact: cap('.cover-contact'), coverBadge: cap('.cover-badge'), docTag: cap('.doc-tag'), shotCap: cap('.doc-shot-cap') };
    const pillarSizes = ['.doc-title', '.pillar-card h3', '.pillar-card p', '.pillar-tags span', '.doc-method-text', '.doc-tag'].map(sel => {
      const el = document.querySelector(sel);
      return { sel, fs: el ? getComputedStyle(el).fontSize : null };
    });
    const winH = window.innerHeight, winW = window.innerWidth, docW = document.querySelector('#pdfdoc').clientWidth, docH = document.querySelector('#pdfdoc').scrollHeight;
    return { totalH, winH, winW, docW, docH, totalPages, blockPages, coverPerPage: cover.map(v => Math.round(v / 700 * 100) + '%'), mainimgs, openerGaps, openerInfo, evidImgs, captionSizes, pillarSizes };
  });
  // 保持 print media，确保 page.pdf 用打印样式渲染（一旦切回 screen，会打印原始网页）

  await page.pdf({
    path: OUT, format: 'A4', landscape: true, printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  // 每个整页节的内容量与图片数（Debug：核对分页与图片落点）
  const casesText = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.doc-case, .doc-dash')).map((cs, i) => ({
      idx: i, chars: cs.textContent.replace(/\s+/g, '').length,
      imgs: cs.querySelectorAll('img').length,
      head: cs.querySelector('.doc-sec-head h2') ? cs.querySelector('.doc-sec-head h2').textContent : cs.className,
    }));
  });

  await browser.close();
  const buf = fs.readFileSync(OUT);
  const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(JSON.stringify({ out: OUT, pages: pageCount, imgTotal: imgOk.total, casesText, layout, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
