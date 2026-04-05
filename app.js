(() => {
  'use strict';

  let tree = null;   // Map<id, {id, title, body, choices}>
  let meta = null;   // {title, description, version, start}
  let history = [];  // stack of visited node IDs

  // --- Parser ---
  function parse(raw) {
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) throw new Error('YAML frontmatter를 찾을 수 없습니다.');
    const fm = {};
    fmMatch[1].split('\n').forEach(line => {
      const i = line.indexOf(':');
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });

    const nodes = new Map();
    const sections = raw.split(/^## /m).slice(1);
    for (const sec of sections) {
      const headerEnd = sec.indexOf('\n');
      const header = sec.slice(0, headerEnd);
      const idMatch = header.match(/^`([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`\s+(.+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      const title = idMatch[2];
      const content = sec.slice(headerEnd + 1).trim();

      const choices = [];
      const bodyLines = [];
      for (const line of content.split('\n')) {
        const cm = line.match(/^- \[(.+?)\]\(#([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\)/);
        if (cm) {
          choices.push({ text: cm[1], target: cm[2] });
        } else {
          bodyLines.push(line);
        }
      }
      nodes.set(id, { id, title, body: bodyLines.join('\n').trim(), choices });
    }
    return { meta: fm, nodes };
  }

  // --- Renderer ---
  function render(nodeId) {
    const card = document.getElementById('card');
    const node = tree.get(nodeId);

    if (!node) {
      showError(`노드 "${nodeId}"를 찾을 수 없습니다.`, true);
      return;
    }

    card.classList.add('fade-out');
    setTimeout(() => {
      let html = `<h2>${node.title}</h2>`;

      if (node.body) {
        html += `<div class="body-text">${markdownToHtml(node.body)}</div>`;
      }

      if (node.choices.length > 0) {
        html += '<div class="choices">';
        node.choices.forEach((c, i) => {
          html += `<button class="choice-btn" data-target="${c.target}">
            <span class="choice-key">${i + 1}</span> ${c.text}
          </button>`;
        });
        html += '</div>';
      } else {
        html += '<button class="restart-btn" id="restart">처음부터 다시 하기</button>';
      }

      if (history.length > 1) {
        html += '<button class="back-btn" id="back">← 이전으로 (Esc)</button>';
      }

      card.innerHTML = html;
      card.classList.remove('fade-out');
      renderProgress();
      bindEvents();
    }, 300);
  }

  function markdownToHtml(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n- /g, '<br>• ');
  }

  function renderProgress() {
    const dots = history.map((_, i) =>
      `<span class="progress-dot${i === history.length - 1 ? ' active' : ''}"></span>`
    ).join('');
    document.getElementById('progress').innerHTML = dots;
  }

  function showError(msg, showHome) {
    const card = document.getElementById('card');
    card.innerHTML = '';
    const err = document.getElementById('error');
    err.hidden = false;
    let html = `<h2>오류</h2><p>${msg}</p>`;
    if (showHome) {
      html += `<br><button class="restart-btn" id="restart">처음으로 돌아가기</button>`;
    }
    err.innerHTML = html;
    const btn = document.getElementById('restart');
    if (btn) btn.addEventListener('click', () => {
      err.hidden = true;
      navigate(meta.start);
    });
  }

  // --- Navigation ---
  function navigate(nodeId) {
    document.getElementById('error').hidden = true;
    if (history[history.length - 1] !== nodeId) history.push(nodeId);
    window.location.hash = nodeId;
    render(nodeId);
  }

  function goBack() {
    if (history.length > 1) {
      history.pop();
      const prev = history[history.length - 1];
      window.location.hash = prev;
      render(prev);
    }
  }

  function bindEvents() {
    document.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.target));
    });
    const restart = document.getElementById('restart');
    if (restart) restart.addEventListener('click', () => {
      history = [];
      navigate(meta.start);
    });
    const back = document.getElementById('back');
    if (back) back.addEventListener('click', goBack);
  }

  // --- Keyboard ---
  document.addEventListener('keydown', e => {
    if (!tree) return;
    if (e.key === 'Escape') { goBack(); return; }
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
      const btns = document.querySelectorAll('.choice-btn');
      if (btns[num - 1]) btns[num - 1].click();
    }
  });

  // --- Hash change ---
  window.addEventListener('hashchange', () => {
    const id = window.location.hash.slice(1);
    if (id && tree && tree.has(id) && history[history.length - 1] !== id) {
      history.push(id);
      render(id);
    }
  });

  // --- Intro ---
  function showIntro(introText, onStart) {
    const card = document.getElementById('card');
    card.innerHTML = `
      <div class="intro-body">
        <h2>저자의 생각</h2>
        <div class="body-text">${markdownToHtml(introText)}</div>
        <button class="choice-btn start-btn" id="start-btn">시작하기</button>
      </div>
    `;
    card.classList.remove('fade-out');
    document.getElementById('start-btn').addEventListener('click', onStart);
  }

  // --- Init ---
  async function init() {
    try {
      const [treeRes, introRes] = await Promise.all([
        fetch('README.md'),
        fetch('data/intro.md')
      ]);
      if (!treeRes.ok) throw new Error(`README.md 로드 실패 (${treeRes.status})`);
      const raw = await treeRes.text();
      const parsed = parse(raw);
      tree = parsed.nodes;
      meta = parsed.meta;
      document.title = meta.title || '의사결정 트리';

      const hashId = window.location.hash.slice(1);
      const startId = (hashId && tree.has(hashId)) ? hashId : meta.start;

      if (introRes.ok && !hashId) {
        const introRaw = await introRes.text();
        // Strip markdown heading (# ...) from intro text
        const introText = introRaw.replace(/^#[^\n]*\n+/, '').trim();
        showIntro(introText, () => navigate(startId));
      } else {
        navigate(startId);
      }
    } catch (err) {
      showError(`${err.message}<br><br><button class="restart-btn" onclick="location.reload()">다시 시도</button>`, false);
    }
  }

  init();
})();
