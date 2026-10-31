(function () {
  const EVENT_LANES = ['案件事实', '人员行为', '资金与物品', '侦查程序', '强制措施'];
  const TERMINAL_STATES = new Set(['ready', 'partial_ready', 'failed']);
  const viewDefinitions = {
    overview: ['案件概览', '案件研判总览'],
    materials: ['案卷材料', '材料处理与覆盖'],
    timeline: ['时间轴', '关键时间与行为'],
    people: ['人物关系', '人员与材料共同提及'],
    events: ['事件进展', '事实与程序进展'],
    evidence: ['证据研判', '证据命题与材料'],
    documents: ['法律文书', '案件相关法律文书'],
  };
  let workspace = null;
  let pollTimer = null;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  }

  function caseIdFromPath() {
    return decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '');
  }

  async function request(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('操作未完成');
    return response.json();
  }

  function formatPage(reference) {
    if (!reference || reference.pageStart == null) return '暂无数据';
    return reference.pageStart === reference.pageEnd ? `第 ${reference.pageStart} 页` : `第 ${reference.pageStart}-${reference.pageEnd} 页`;
  }

  function sourceExcerpt(reference) {
    const chunk = workspace?.chunks?.find((item) => item.id === reference?.chunkId);
    return chunk?.text || '暂无数据';
  }

  function openSourceDrawer(sourceRefs) {
    const refs = Array.isArray(sourceRefs) ? sourceRefs : [];
    const reference = refs[0];
    document.getElementById('sourceFile').textContent = reference?.fileName || workspace?.files?.find((file) => file.id === reference?.fileId)?.name || '暂无数据';
    document.getElementById('sourceFragment').textContent = reference?.chunkId || '暂无数据';
    document.getElementById('sourcePage').textContent = formatPage(reference);
    document.getElementById('sourceExcerpt').textContent = sourceExcerpt(reference);
    document.getElementById('sourceDrawer').classList.add('open');
    document.getElementById('sourceDrawer').setAttribute('aria-hidden', 'false');
    document.getElementById('sourceBackdrop').classList.add('open');
  }

  function closeSourceDrawer() {
    document.getElementById('sourceDrawer').classList.remove('open');
    document.getElementById('sourceDrawer').setAttribute('aria-hidden', 'true');
    document.getElementById('sourceBackdrop').classList.remove('open');
  }

  function navigateWithScope(view, scope = {}) {
    const params = new URLSearchParams(location.search);
    params.set('view', view);
    for (const [key, value] of Object.entries(scope)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    history.pushState({}, '', `${location.pathname}?${params.toString()}`);
    activateCaseView(view, false);
  }

  function bindSourceButtons(container) {
    container.querySelectorAll('[data-source-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const items = container._sourceItems || [];
        openSourceDrawer(items[Number(button.dataset.sourceIndex)]?.sourceRefs);
      });
    });
  }

  function renderEmpty() {
    return '<div class="empty-state">暂无数据</div>';
  }

  function renderOverview() {
    const item = workspace.case;
    const summary = workspace.summaries?.case?.summary || workspace.summaries?.case?.caseSummary || '';
    const readyFiles = workspace.files.filter((file) => file.status === 'ready').length;
    const needsAttention = workspace.files.filter((file) => ['needs_ocr', 'failed'].includes(file.status)).length;
    return `
      <div class="workspace-metrics">
        <div><span>材料总数</span><strong>${workspace.files.length}</strong></div>
        <div><span>已完成</span><strong>${readyFiles}</strong></div>
        <div><span>待处理</span><strong>${needsAttention}</strong></div>
        <div><span>候选时间点</span><strong>${workspace.views.timeline.length}</strong></div>
      </div>
      <section class="workspace-section"><span class="page-kicker">案件摘要</span><h3>${escapeHtml(item.name)}</h3><p class="case-summary-text">${escapeHtml(summary || '暂无数据')}</p></section>
      <section class="workspace-section"><span class="page-kicker">律师提示</span><p class="case-summary-text">所有人物关系、事件和证据方向均为模型候选，不代表事实认定或法律结论。请通过来源抽屉核对原文。</p></section>`;
  }

  function renderMaterials() {
    if (!workspace.files.length) return renderEmpty();
    return `<div class="material-list">${workspace.files.map((file) => `
      <article class="material-row"><div><strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(file.ext?.toUpperCase())} · ${file.chunkCount || 0} 个片段</span></div><span class="case-status case-status-${escapeHtml(file.status)}">${file.status === 'ready' ? '已提取' : file.status === 'needs_ocr' ? '需要 OCR' : file.status === 'failed' ? '待处理' : '处理中'}</span></article>`).join('')}</div>`;
  }

  function renderTimeline(items) {
    const known = items.filter((item) => item.precision !== 'unknown' && item.date && !/不详|未知/.test(item.date));
    const unknown = items.filter((item) => !known.includes(item));
    const ordered = [...known.sort((a, b) => String(a.date).localeCompare(String(b.date))), ...unknown];
    if (!ordered.length) return renderEmpty();
    const container = document.createElement('div');
    container.className = 'timeline';
    container._sourceItems = ordered;
    container.innerHTML = ordered.map((item, index) => `
      <button class="timeline-item" type="button" data-source-index="${index}">
        <span class="timeline-date">${escapeHtml(known.includes(item) ? item.date : '时间待确认')}</span>
        <span class="timeline-dot"></span>
        <span class="timeline-content"><strong>${escapeHtml(item.title || '未命名事件')}</strong><span>${escapeHtml(item.detail || '点击核验来源')}</span></span>
      </button>`).join('');
    bindSourceButtons(container);
    return container;
  }

  function renderPeopleGraph(people, relations) {
    if (!people.length) return renderEmpty();
    const relationTypes = [...new Set(relations.map((item) => item.type).filter(Boolean))];
    const width = 760;
    const height = 500;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.34;
    const positions = new Map(people.map((person, index) => [person.id, { x: centerX + Math.cos((index / people.length) * Math.PI * 2 - Math.PI / 2) * radius, y: centerY + Math.sin((index / people.length) * Math.PI * 2 - Math.PI / 2) * radius }]));
    const container = document.createElement('div');
    container.className = 'people-graph-wrap';
    container._sourceItems = [...relations, ...people];
    container.innerHTML = `
      <div class="graph-controls"><label>关系类型<select id="relationTypeFilter"><option value="">全部</option>${relationTypes.map((type) => `<option>${escapeHtml(type)}</option>`).join('')}</select></label></div>
      <div class="people-graph-stage">
        <svg class="people-edges" viewBox="0 0 ${width} ${height}" role="img" aria-label="人物关系图">${relations.map((relation, index) => { const from = positions.get(relation.from); const to = positions.get(relation.to); return from && to ? `<line data-relation-type="${escapeHtml(relation.type)}" data-source-index="${index}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>` : ''; }).join('')}</svg>
        ${people.map((person, index) => { const point = positions.get(person.id); return `<button class="person-node" type="button" data-source-index="${relations.length + index}" style="left:${(point.x / width) * 100}%;top:${(point.y / height) * 100}%"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.role || '身份待确认')}</span></button>`; }).join('')}
      </div>`;
    container.querySelector('#relationTypeFilter').addEventListener('change', (event) => {
      container.querySelectorAll('[data-relation-type]').forEach((line) => { line.style.display = !event.target.value || line.dataset.relationType === event.target.value ? '' : 'none'; });
    });
    bindSourceButtons(container);
    return container;
  }

  function renderEventLanes(events) {
    const container = document.createElement('div');
    container.className = 'event-lanes';
    container._sourceItems = events;
    container.innerHTML = EVENT_LANES.map((lane) => {
      const laneItems = events.map((item, index) => ({ item, index })).filter(({ item }) => item.lane === lane);
      return `<section class="event-lane"><h3>${lane}</h3><div>${laneItems.length ? laneItems.map(({ item, index }) => `<button type="button" data-source-index="${index}"><span>${escapeHtml(item.date || '时间待确认')}</span><strong>${escapeHtml(item.title || '未命名事件')}</strong><small>${escapeHtml(item.detail || '点击核验来源')}</small></button>`).join('') : '<p>暂无数据</p>'}</div></section>`;
    }).join('');
    bindSourceButtons(container);
    return container;
  }

  function renderEvidence(items) {
    if (!items.length) return renderEmpty();
    const container = document.createElement('div');
    container.className = 'evidence-grid';
    container._sourceItems = items;
    container.innerHTML = items.map((item, index) => `<button class="evidence-card" type="button" data-source-index="${index}"><span>${escapeHtml(item.direction || '方向待确认')}</span><strong>${escapeHtml(item.proposition || '证据命题')}</strong><p>${escapeHtml(item.material || '暂无数据')}</p><small>候选 · 点击核验来源</small></button>`).join('');
    bindSourceButtons(container);
    return container;
  }

  function renderDocuments() {
    const documents = workspace.documents || [];
    const list = documents.length ? `<div class="material-list">${documents.map((document) => `
      <a class="material-row" href="/documents?caseId=${encodeURIComponent(workspace.case.id)}&docId=${encodeURIComponent(document.id)}"><div><strong>${escapeHtml(document.typeName)}</strong><span>${new Date(document.updatedAt).toLocaleString('zh-CN')} · ${escapeHtml(document.model)}</span></div><span class="case-status">${document.status === 'completed' ? '已完成' : '审阅中'}</span></a>`).join('')}</div>` : renderEmpty();
    return `<div class="workspace-section"><h3>从案件研判生成法律文书</h3><p class="case-summary-text">可生成质证意见、审查起诉阶段法律意见书、羁押必要性审查申请。初稿按段落生成，必须由律师逐段修改并确认。</p><a class="btn btn-primary" href="/documents?caseId=${encodeURIComponent(workspace.case.id)}">生成本案文书</a></div>${list}`;
  }

  function openSourceFromQuery() {
    const source = new URLSearchParams(location.search).get('source');
    if (!source || !workspace) return;
    const chunk = workspace.chunks.find((item) => item.id === source);
    if (!chunk) return;
    openSourceDrawer([{ chunkId: chunk.id, fileId: chunk.fileId, fileName: chunk.fileName, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd }]);
  }

  function activateCaseView(view, updateUrl = true) {
    const active = viewDefinitions[view] ? view : 'overview';
    if (updateUrl) {
      const params = new URLSearchParams(location.search);
      params.set('view', active);
      history.pushState({}, '', `${location.pathname}?${params.toString()}`);
    }
    document.querySelectorAll('[data-case-view]').forEach((button) => button.classList.toggle('active', button.dataset.caseView === active));
    document.getElementById('viewKicker').textContent = viewDefinitions[active][0];
    document.getElementById('viewTitle').textContent = viewDefinitions[active][1];
    document.getElementById('generateDocumentLink').href = `/documents?caseId=${encodeURIComponent(workspace?.case?.id || caseIdFromPath())}&view=${active}`;
    const target = document.getElementById('caseViewContent');
    if (!workspace) { target.innerHTML = renderEmpty(); return; }
    let content;
    if (active === 'overview') content = renderOverview();
    if (active === 'materials') content = renderMaterials();
    if (active === 'timeline') content = renderTimeline(workspace.views.timeline || []);
    if (active === 'people') content = renderPeopleGraph(workspace.views.people || [], workspace.views.relations || []);
    if (active === 'events') content = renderEventLanes(workspace.views.events || []);
    if (active === 'evidence') content = renderEvidence(workspace.views.evidence || []);
    if (active === 'documents') content = renderDocuments();
    target.replaceChildren();
    if (typeof content === 'string') target.innerHTML = content;
    else target.append(content);
  }

  function renderWorkspace() {
    document.getElementById('caseTitle').textContent = workspace.case.name;
    document.getElementById('caseSubtitle').textContent = `模型：${workspace.case.model} · ${workspace.files.length} 份材料`;
    document.getElementById('caseStatus').textContent = ({ ready: '可查看', partial_ready: '部分完成', failed: '待处理' })[workspace.case.status] || '处理中';
    document.getElementById('caseStatus').className = `case-status case-status-${workspace.case.status}`;
    const percent = Number(workspace.case.progress?.percent || 0);
    document.getElementById('caseProgressText').textContent = `${percent}%`;
    document.getElementById('caseProgressBar').style.width = `${percent}%`;
    activateCaseView(new URLSearchParams(location.search).get('view') || 'overview', false);
  }

  async function loadWorkspace() {
    try {
      workspace = await request(`/api/cases/${encodeURIComponent(caseIdFromPath())}`);
      renderWorkspace();
      openSourceFromQuery();
    } catch (error) {
      console.error('Failed to load case workspace:', error);
      document.getElementById('caseViewContent').innerHTML = renderEmpty();
    }
  }

  async function pollCaseStatus() {
    try {
      const status = await request(`/api/cases/${encodeURIComponent(caseIdFromPath())}/status`);
      if (workspace) workspace.case = status;
      if (TERMINAL_STATES.has(status.status)) {
        clearInterval(pollTimer);
        pollTimer = null;
        await loadWorkspace();
      } else if (workspace) {
        renderWorkspace();
      }
    } catch (error) {
      console.error('Failed to poll case status:', error);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('[data-case-view]').forEach((button) => button.addEventListener('click', () => navigateWithScope(button.dataset.caseView)));
    document.getElementById('closeSourceDrawer').addEventListener('click', closeSourceDrawer);
    document.getElementById('sourceBackdrop').addEventListener('click', closeSourceDrawer);
    window.addEventListener('popstate', () => activateCaseView(new URLSearchParams(location.search).get('view') || 'overview', false));
    await loadWorkspace();
    if (workspace && !TERMINAL_STATES.has(workspace.case.status)) pollTimer = setInterval(pollCaseStatus, 1500);
  });
  window.addEventListener('beforeunload', () => { if (pollTimer) clearInterval(pollTimer); });

  window.activateCaseView = activateCaseView;
  window.openSourceDrawer = openSourceDrawer;
  window.navigateWithScope = navigateWithScope;
  window.pollCaseStatus = pollCaseStatus;
  window.renderTimeline = renderTimeline;
  window.renderPeopleGraph = renderPeopleGraph;
  window.renderEventLanes = renderEventLanes;
})();
