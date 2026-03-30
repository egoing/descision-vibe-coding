(() => {
  'use strict';

  // [debug:#5] Tree UI rewrite - issue #5
  console.log('[debug:#5] app.js loaded - tree layout mode');

  let tree = null;   // Map<id, {id, title, body, choices}>
  let meta = null;   // {title, description, version, start}
  let history = [];  // stack of visited node IDs
  let nodePositions = new Map(); // Map<id, {x, y}>
  let selectedNode = null;

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

  function markdownToHtml(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n- /g, '<br>• ');
  }

  // --- Tree Layout Calculation ---
  function buildTreeLayout() {
    // [debug:#5] calculating tree layout positions
    console.log('[debug:#5] buildTreeLayout() called');

    const startId = meta.start;
    const levels = new Map(); // id -> level
    const visited = new Set();
    const queue = [[startId, 0]];
    const levelNodes = {}; // level -> [id]
    const parentMap = new Map(); // id -> parentId

    while (queue.length > 0) {
      const [id, level] = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      levels.set(id, level);
      if (!levelNodes[level]) levelNodes[level] = [];
      levelNodes[level].push(id);

      const node = tree.get(id);
      if (node) {
        for (const choice of node.choices) {
          if (!visited.has(choice.target)) {
            queue.push([choice.target, level + 1]);
            parentMap.set(choice.target, id);
          }
        }
      }
    }

    const NODE_W = 160;
    const NODE_H = 60;
    const H_GAP = 40;
    const V_GAP = 100;
    const maxLevel = Math.max(...Object.keys(levelNodes).map(Number));

    nodePositions = new Map();
    for (let lvl = 0; lvl <= maxLevel; lvl++) {
      const nodes = levelNodes[lvl] || [];
      const totalW = nodes.length * NODE_W + (nodes.length - 1) * H_GAP;
      nodes.forEach((id, i) => {
        const x = -totalW / 2 + i * (NODE_W + H_GAP) + NODE_W / 2;
        const y = lvl * (NODE_H + V_GAP);
        nodePositions.set(id, { x, y, w: NODE_W, h: NODE_H });
      });
    }

    console.log('[debug:#5] nodePositions built for', nodePositions.size, 'nodes');
    return { parentMap, levelNodes };
  }

  // --- Render Tree ---
  function renderTree(activeNodeId) {
    console.log('[debug:#5] renderTree() activeNodeId=', activeNodeId);

    // Remove existing center panel and tree-container
    const existingPanel = document.getElementById('center-panel');
    if (existingPanel) existingPanel.remove();
    const existingContainer = document.getElementById('tree-container');
    if (existingContainer) existingContainer.remove();

    const wrapper = document.getElementById('tree-wrapper');
    const { parentMap } = buildTreeLayout();

    // Container
    const container = document.createElement('div');
    container.id = 'tree-container';

    // SVG for lines
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'tree-svg';
    container.appendChild(svg);

    // Nodes
    const nodesDiv = document.createElement('div');
    nodesDiv.id = 'tree-nodes';
    container.appendChild(nodesDiv);

    wrapper.appendChild(container);

    // Compute bounding box to set offsets
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, pos] of nodePositions) {
      minX = Math.min(minX, pos.x - pos.w / 2);
      minY = Math.min(minY, pos.y - pos.h / 2);
      maxX = Math.max(maxX, pos.x + pos.w / 2);
      maxY = Math.max(maxY, pos.y + pos.h / 2);
    }
    const padding = 40;
    const totalW = maxX - minX + padding * 2;
    const totalH = maxY - minY + padding * 2;
    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    container.style.width = totalW + 'px';
    container.style.height = totalH + 'px';
    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

    // Draw lines (edges)
    for (const [childId, parentId] of parentMap) {
      const cp = nodePositions.get(childId);
      const pp = nodePositions.get(parentId);
      if (!cp || !pp) continue;

      const x1 = pp.x + offsetX;
      const y1 = pp.y + offsetY + pp.h / 2;
      const x2 = cp.x + offsetX;
      const y2 = cp.y + offsetY - cp.h / 2;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (y1 + y2) / 2;
      line.setAttribute('d', `M ${x1} ${y1} C ${x1} ${mx}, ${x2} ${mx}, ${x2} ${y2}`);
      line.setAttribute('stroke', 'var(--tree-line)');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('fill', 'none');
      line.setAttribute('class', 'tree-edge');

      // Highlight path to active node
      if (isInPath(activeNodeId, childId, parentMap) || isInPath(activeNodeId, parentId, parentMap)
          || childId === activeNodeId || parentId === activeNodeId) {
        line.classList.add('tree-edge-active');
      }
      svg.appendChild(line);
    }

    // Draw nodes
    for (const [id, pos] of nodePositions) {
      const node = tree.get(id);
      if (!node) continue;

      const div = document.createElement('div');
      div.className = 'tree-node';
      div.dataset.id = id;
      div.style.left = (pos.x + offsetX - pos.w / 2) + 'px';
      div.style.top = (pos.y + offsetY - pos.h / 2) + 'px';
      div.style.width = pos.w + 'px';
      div.style.height = pos.h + 'px';

      const inHistoryIdx = history.indexOf(id);
      if (id === activeNodeId) {
        div.classList.add('tree-node-active');
      } else if (inHistoryIdx >= 0) {
        div.classList.add('tree-node-visited');
      }

      // Check if this is a child of active node
      const activeNode = tree.get(activeNodeId);
      if (activeNode && activeNode.choices.some(c => c.target === id)) {
        div.classList.add('tree-node-child');
      }

      div.innerHTML = `<span class="tree-node-title">${node.title}</span>`;
      div.addEventListener('click', () => onNodeClick(id));
      nodesDiv.appendChild(div);
    }

    // Scroll active node into center
    scrollToNode(activeNodeId, offsetX, offsetY);

    // Show center modal for active node if it has choices or body
    showCenterPanel(activeNodeId);
  }

  function isInPath(targetId, nodeId, parentMap) {
    let cur = nodeId;
    const visited = new Set();
    while (cur && !visited.has(cur)) {
      if (cur === targetId) return true;
      visited.add(cur);
      cur = parentMap.get(cur);
    }
    return false;
  }

  function scrollToNode(nodeId, offsetX, offsetY) {
    const pos = nodePositions.get(nodeId);
    if (!pos) return;
    const absX = pos.x + offsetX;
    const absY = pos.y + offsetY;
    const wrapper = document.getElementById('tree-wrapper');
    if (!wrapper) return;
    const ww = wrapper.clientWidth;
    const wh = wrapper.clientHeight;
    wrapper.scrollLeft = absX - ww / 2;
    wrapper.scrollTop = absY - wh / 2;
  }

  // --- Center Panel ---
  function showCenterPanel(nodeId) {
    console.log('[debug:#5] showCenterPanel() nodeId=', nodeId);
    const existing = document.getElementById('center-panel');
    if (existing) existing.remove();

    const node = tree.get(nodeId);
    if (!node) return;

    const panel = document.createElement('div');
    panel.id = 'center-panel';
    panel.className = 'center-panel-enter';

    let html = `<div class="center-panel-header">
      <h2>${node.title}</h2>
      <button class="center-panel-close" id="close-panel" title="닫기">×</button>
    </div>`;

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
      html += '<div class="leaf-message">최종 선택입니다.</div>';
      html += '<button class="restart-btn" id="restart">처음부터 다시 하기</button>';
    }

    panel.innerHTML = html;
    document.getElementById('app').appendChild(panel);

    // Trigger animation
    requestAnimationFrame(() => {
      panel.classList.remove('center-panel-enter');
      panel.classList.add('center-panel-visible');
    });

    // Bind events
    panel.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.target));
    });
    const closeBtn = document.getElementById('close-panel');
    if (closeBtn) closeBtn.addEventListener('click', () => {
      panel.classList.remove('center-panel-visible');
      panel.classList.add('center-panel-exit');
      setTimeout(() => panel.remove(), 300);
    });
    const restart = document.getElementById('restart');
    if (restart) restart.addEventListener('click', () => {
      history = [];
      navigate(meta.start);
    });
  }

  // --- Navigation ---
  function onNodeClick(nodeId) {
    console.log('[debug:#5] onNodeClick()', nodeId);
    navigate(nodeId);
  }

  function navigate(nodeId) {
    console.log('[debug:#5] navigate()', nodeId);
    document.getElementById('error') && (document.getElementById('error').hidden = true);
    if (history[history.length - 1] !== nodeId) history.push(nodeId);
    window.location.hash = nodeId;
    renderTree(nodeId);
  }

  function showError(msg) {
    const app = document.getElementById('app');
    app.innerHTML = `<div id="error"><h2>오류</h2><p>${msg}</p></div>`;
  }

  // --- Keyboard ---
  document.addEventListener('keydown', e => {
    if (!tree) return;
    if (e.key === 'Escape') {
      const panel = document.getElementById('center-panel');
      if (panel) {
        panel.classList.remove('center-panel-visible');
        panel.classList.add('center-panel-exit');
        setTimeout(() => panel.remove(), 300);
      }
      return;
    }
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
      const btns = document.querySelectorAll('#center-panel .choice-btn');
      if (btns[num - 1]) btns[num - 1].click();
    }
  });

  // --- Hash change ---
  window.addEventListener('hashchange', () => {
    const id = window.location.hash.slice(1);
    if (id && tree && tree.has(id) && history[history.length - 1] !== id) {
      history.push(id);
      renderTree(id);
    }
  });

  // --- Init ---
  async function init() {
    try {
      // Setup wrapper
      const app = document.getElementById('app');
      app.innerHTML = '';
      const wrapperEl = document.createElement('div');
      wrapperEl.id = 'tree-wrapper';
      app.appendChild(wrapperEl);

      const res = await fetch('README.md');
      if (!res.ok) throw new Error(`README.md 로드 실패 (${res.status})`);
      const raw = await res.text();
      const parsed = parse(raw);
      tree = parsed.nodes;
      meta = parsed.meta;
      document.title = meta.title || '의사결정 트리';

      console.log('[debug:#5] tree loaded, nodes:', tree.size);

      const hashId = window.location.hash.slice(1);
      const startId = (hashId && tree.has(hashId)) ? hashId : meta.start;

      navigate(startId);
    } catch (err) {
      showError(`${err.message}<br><br><button class="restart-btn" onclick="location.reload()">다시 시도</button>`);
    }
  }

  init();
})();
