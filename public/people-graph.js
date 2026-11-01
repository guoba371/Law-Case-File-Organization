(function () {
  let library;
  let registered = false;
  const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
  function loadLibrary() {
    if (window.G6) return Promise.resolve(window.G6);
    if (!library) library = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/g6.min.js';
      script.onload = () => resolve(window.G6);
      script.onerror = () => { library = null; script.remove(); reject(new Error('Graph library unavailable')); };
      document.head.append(script);
    });
    return library;
  }
  function text(parent, tag, value, className = '') {
    const child = document.createElement(tag);
    child.className = className;
    child.textContent = value;
    parent.append(child);
    return child;
  }
  function short(value, length) {
    const chars = Array.from(String(value || ''));
    return chars.length > length ? `${chars.slice(0, length - 1).join('')}…` : chars.join('');
  }
  function graphStyles() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const colors = dark
      ? { canvas: '#1c1c1e', surface: '#20242b', text: '#f3f5f7', muted: '#b5bdc9', edge: '#8494a8', accent: '#7bb5ff', blue: '#90bdff', teal: '#80d6ca', amber: '#edc48b' }
      : { canvas: '#fbfbfd', surface: '#ffffff', text: '#182434', muted: '#4e6075', edge: '#7c8fa7', accent: '#1766c1', blue: '#2563a9', teal: '#15786e', amber: '#8c5c18' };
    const roleColor = (role) => /当事人|嫌疑|被告/.test(role || '') ? colors.blue : /证人/.test(role || '') ? colors.teal : /被害/.test(role || '') ? colors.amber : colors.muted;
    return {
      background: colors.canvas,
      node: {
        type: 'case-person',
        style: {
          size: [192, 88], radius: 12, fill: colors.surface, stroke: colors.edge, lineWidth: 1.25,
          labelText: (node) => short(node.data.name || '姓名待确认', 21),
          labelPlacement: 'center', labelOffsetY: -12, labelFontSize: 16, labelFontWeight: 600,
          labelFill: colors.text, labelFontFamily: FONT, labelWordWrap: true, labelMaxWidth: 164, labelMaxLines: 2,
          roleText: (node) => short(node.data.role || '身份待确认', 13), roleFill: (node) => roleColor(node.data.role),
          cursor: 'pointer', shadowColor: dark ? '#00000020' : '#1824340c', shadowBlur: 12, shadowOffsetY: 4,
        },
        state: { selected: { stroke: colors.accent, lineWidth: 2.5 }, related: { stroke: colors.accent }, muted: { opacity: 0.2 } },
      },
      edge: {
        type: 'quadratic',
        style: {
          stroke: colors.edge, lineWidth: 1.5, endArrow: false, startArrow: false, cursor: 'pointer',
          labelText: (edge) => short(edge.data.type || '关系待核对', 10),
          labelFontFamily: FONT, labelFontSize: 12, labelFill: colors.muted,
          labelBackground: true, labelBackgroundFill: colors.surface, labelBackgroundRadius: 5,
          labelPadding: [4, 7], labelAutoRotate: false, labelOffsetY: 0,
        },
        state: { selected: { stroke: colors.accent, lineWidth: 2.5 }, related: { stroke: colors.accent, lineWidth: 2 }, muted: { opacity: 0.12 } },
      },
    };
  }
  function graphLayout(width) {
    const vertical = width < 600;
    return {
      type: 'antv-dagre', rankdir: vertical ? 'TB' : 'LR', animation: false,
      nodeSize: [192, 88], nodesep: vertical ? 48 : 72, ranksep: vertical ? 108 : 126,
      edgeLabelSpace: true, controlPoints: true,
    };
  }
  function registerPerson(G6) {
    if (registered) return;
    class Person extends G6.Rect {
      render(attributes, container) {
        super.render(attributes, container);
        this.upsert('role', 'text', {
          text: attributes.roleText, x: 0, y: 23, textAlign: 'center', textBaseline: 'middle',
          fontSize: 12, fontFamily: FONT, fill: attributes.roleFill, pointerEvents: 'none',
        }, container);
      }
    }
    G6.register(G6.ExtensionCategory.NODE, 'case-person', Person);
    registered = true;
  }

  window.createPeopleGraph = function ({ people = [], relations = [], records, onSource }) {
    const { buildPeopleGraph } = window.PeopleGraphData;
    const model = buildPeopleGraph(people, relations);
    const element = document.createElement('section');
    element.className = 'people-graph';
    element.innerHTML = `
      <div class="people-toolbar">
        <div class="people-search"><label>查找人物<input data-people-search type="search" placeholder="输入姓名或身份" autocomplete="off"></label><div class="people-search-results" hidden></div></div>
        <label class="people-filter">关系类型<select data-people-filter><option value="">全部关系</option></select></label>
        <label class="people-direct"><input data-people-direct type="checkbox" disabled>只看此人的直接关系</label>
        <button type="button" data-people-action="reset">恢复全图</button>
      </div>
      <p class="people-status" role="status">正在绘制人物关系…</p>
      <div class="people-view-tools">
        <div class="people-view-actions">
          <button type="button" data-people-action="out" aria-label="缩小人物关系图" disabled>−</button>
          <output data-people-scale>100%</output>
          <button type="button" data-people-action="in" aria-label="放大人物关系图" disabled>＋</button>
          <button type="button" data-people-action="fit" disabled>适应画布</button>
          <button type="button" data-people-action="fullscreen">全屏查看</button>
          <button type="button" data-people-action="download" disabled>下载 PNG</button>
        </div>
      </div>
      <div class="people-stage">
        <div class="people-canvas" role="img" aria-label="人物关系交互图；下方原记录提供键盘可访问的人员与来源"></div>
        <aside class="people-detail" aria-label="人物与关系详情" hidden></aside>
      </div>
      <div class="people-isolated"></div>
      <details class="diagram-records"><summary>查看全部原记录与来源</summary></details>`;
    element.querySelector('.diagram-records').append(records);
    const canvas = element.querySelector('.people-canvas');
    const status = element.querySelector('.people-status');
    const detail = element.querySelector('.people-detail');
    const search = element.querySelector('[data-people-search]');
    const results = element.querySelector('.people-search-results');
    const filter = element.querySelector('[data-people-filter]');
    const direct = element.querySelector('[data-people-direct]');
    model.relationTypes.forEach((type) => { const option = text(filter, 'option', type); option.value = type; });
    let current = model;
    let focusId = '';
    let graph;
    let destroyed = false;
    let ready = false;
    let pending = Promise.resolve();
    let previousOverflow;
    const displayScale = () => { if (!destroyed && graph) element.querySelector('[data-people-scale]').textContent = `${Math.round(graph.getZoom() * 100)}%`; };
    function enableGraphControls(enabled) {
      ['out', 'in', 'fit', 'download'].forEach((action) => { element.querySelector(`[data-people-action="${action}"]`).disabled = !enabled; });
    }
    function enqueue(action) {
      pending = pending.then(() => { if (!destroyed) return action(); }).catch(() => {
        if (!destroyed) status.textContent = '操作暂未完成，可通过下方原记录核验来源。';
      });
      return pending;
    }
    async function highlight(id, isEdge = false) {
      if (!graph || !ready) return;
      const adjacent = new Set([id]);
      const relevant = current.edges.filter((edge) => isEdge ? edge.id === id : edge.source === id || edge.target === id);
      relevant.forEach((edge) => { adjacent.add(edge.source); adjacent.add(edge.target); });
      const states = {};
      current.nodes.forEach((node) => { states[node.id] = !id ? [] : node.id === id ? ['selected'] : adjacent.has(node.id) ? ['related'] : ['muted']; });
      current.edges.forEach((edge) => { states[edge.id] = !id ? [] : edge.id === id ? ['selected'] : relevant.includes(edge) ? ['related'] : ['muted']; });
      await graph.setElementState(states, false);
    }
    async function redraw() {
      current = buildPeopleGraph(people, relations, { relationType: filter.value, focusId, directOnly: direct.checked });
      if (!graph || !ready) return;
      detail.hidden = true;
      graph.setData({ nodes: current.nodes, edges: current.edges });
      await graph.render();
      if (destroyed) return;
      enableGraphControls(current.nodes.length > 0);
      if (current.nodes.length) { await readableFit(); await highlight(focusId); }
      status.textContent = current.nodes.length ? description() : '当前筛选下暂无关系数据，可切换关系类型或恢复全图。';
    }
    function description() {
      return `${people.length} 位人员 · 当前显示 ${current.edges.length} 条关系。${focusId ? '已聚焦选中人物。' : ''}候选关系不代表事实认定。${model.unresolved.length ? `另有 ${model.unresolved.length} 条关系端点待确认，详见原记录。` : ''}`;
    }
    async function readableFit() {
      await graph.fitView({}, false);
      if (destroyed) return;
      const width = canvas.clientWidth || window.innerWidth || 900;
      await graph.zoomTo(Math.max(width < 600 ? 0.6 : 0.72, Math.min(1, graph.getZoom())), false);
      await graph.fitCenter(false);
      displayScale();
    }
    async function selectPerson(person, center = false) {
      focusId = person.id;
      direct.disabled = false;
      if (direct.checked) await redraw();
      if (destroyed) return;
      await highlight(focusId);
      if (center && ready && current.nodes.some((node) => node.id === focusId)) {
        await graph.zoomTo(1, false);
        await graph.focusElement(focusId, false);
        displayScale();
      }
      showDetail(person, false);
      status.textContent = description();
    }
    search.addEventListener('input', () => {
      results.replaceChildren();
      const value = search.value.trim().toLocaleLowerCase();
      results.hidden = !value;
      if (!value) return;
      const matches = model.allPeople.filter((person) => `${person.data.name} ${person.data.role || ''}`.toLocaleLowerCase().includes(value));
      if (!matches.length) text(results, 'p', '未找到匹配人物');
      matches.forEach((person) => {
        const button = text(results, 'button', `${person.data.name} · ${person.data.role || '身份待确认'}`);
        button.type = 'button'; button.dataset.personResult = person.id;
        button.addEventListener('click', () => { results.hidden = true; search.value = person.data.name; enqueue(() => selectPerson(person, true)); });
      });
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') results.hidden = true;
      if (event.key === 'Enter') { event.preventDefault(); results.querySelector('button')?.click(); }
    });
    filter.addEventListener('change', () => enqueue(redraw));
    direct.addEventListener('change', () => enqueue(redraw));
    element.querySelector('[data-people-action="reset"]').addEventListener('click', () => {
      focusId = ''; filter.value = ''; direct.checked = false; direct.disabled = true; search.value = ''; results.hidden = true;
      enqueue(redraw);
    });
    const themeObserver = new MutationObserver(() => enqueue(async () => {
      if (!ready) return;
      const styles = graphStyles();
      graph.setOptions({ background: styles.background });
      graph.setNode(styles.node); graph.setEdge(styles.edge);
      await graph.draw();
    }));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const resizeObserver = new ResizeObserver(() => enqueue(() => {
      if (ready && canvas.clientWidth && canvas.clientHeight) graph.resize(canvas.clientWidth, canvas.clientHeight);
    }));
    resizeObserver.observe(canvas);
    function fullscreen(open) {
      element.classList.toggle('is-fullscreen', open);
      const button = element.querySelector('[data-people-action="fullscreen"]');
      button.textContent = open ? '退出全屏' : '全屏查看';
      button.setAttribute('aria-pressed', String(open));
      if (open) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
      else { document.body.style.overflow = previousOverflow || ''; button.focus(); }
    }
    function escape(event) {
      if (event.key === 'Escape') {
        results.hidden = true;
        detail.hidden = true;
        if (element.classList.contains('is-fullscreen')) fullscreen(false);
      }
    }
    document.addEventListener('keydown', escape);
    element.querySelector('[data-people-action="fullscreen"]').addEventListener('click', () => fullscreen(!element.classList.contains('is-fullscreen')));
    ['out', 'in'].forEach((action) => element.querySelector(`[data-people-action="${action}"]`).addEventListener('click', () => enqueue(async () => {
      if (!ready) return;
      await graph.zoomTo(Math.max(0.2, Math.min(3, graph.getZoom() * (action === 'in' ? 1.25 : 0.8))), false);
      displayScale();
    })));
    element.querySelector('[data-people-action="fit"]').addEventListener('click', () => enqueue(async () => {
      if (ready) { await graph.fitView({}, false); displayScale(); }
    }));
    element.querySelector('[data-people-action="download"]').addEventListener('click', () => enqueue(async () => {
      if (!ready) return;
      const button = element.querySelector('[data-people-action="download"]');
      button.disabled = true;
      try {
        const url = await graph.toDataURL({ mode: 'viewport', type: 'image/png' });
        if (destroyed) return;
        const blob = await (await fetch(url)).blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl; link.download = '人物关系-当前视图-候选研判.png';
        element.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      } finally { if (!destroyed) button.disabled = false; }
    }));

    function showDetail(item, isEdge) {
      detail.replaceChildren();
      detail.hidden = false;
      const close = text(detail, 'button', '关闭详情', 'people-detail-close');
      close.type = 'button';
      close.addEventListener('click', () => { detail.hidden = true; });
      const name = (id) => model.allPeople.find((person) => person.id === id)?.data.name || '人员待确认';
      text(detail, 'span', isEdge ? '关系记录 · 待核验' : '人员记录 · 待核验', 'people-detail-kind');
      text(detail, 'h3', isEdge ? `${name(item.source)} / ${name(item.target)}` : item.data.name || '姓名待确认');
      text(detail, 'p', isEdge ? item.data.type || '关系待核对' : item.data.role || '身份待确认', 'people-detail-role');
      if (isEdge) text(detail, 'p', item.data.label || '暂无关系说明');
      text(detail, 'h4', `材料来源（${item.data.sourceRefs.length}）`);
      if (!item.data.sourceRefs.length) text(detail, 'p', '暂无来源数据，请查看原记录。');
      item.data.sourceRefs.forEach((ref, index) => {
        const page = ref.pageStart == null ? '页码待核对' : `第 ${ref.pageStart}${ref.pageEnd && ref.pageEnd !== ref.pageStart ? `–${ref.pageEnd}` : ''} 页`;
        const button = text(detail, 'button', `${index + 1}. ${ref.fileName || '来源材料'} · ${page}`, 'people-source-link');
        button.type = 'button';
        button.dataset.sourceRef = String(index);
        button.addEventListener('click', () => onSource([ref]));
      });
    }
    const isolated = element.querySelector('.people-isolated');
    if (model.isolated.length) {
      text(isolated, 'p', `尚无关系记录的人员（${model.isolated.length}）`, 'people-isolated-title');
      model.isolated.forEach((person) => {
        const button = text(isolated, 'button', `${person.data.name || '姓名待确认'} · ${person.data.role || '身份待确认'}`);
        button.type = 'button';
        button.addEventListener('click', () => enqueue(() => selectPerson(person)));
      });
    }

    async function load() {
      if (!model.nodes.length) { status.textContent = '暂无关系数据'; canvas.hidden = true; return; }
      try {
        const G6 = await loadLibrary();
        if (destroyed) return;
        registerPerson(G6);
        const width = canvas.clientWidth || window.innerWidth || 900;
        graph = new G6.Graph({
          container: canvas, width, height: canvas.clientHeight || 560,
          data: { nodes: model.nodes, edges: model.edges }, ...graphStyles(),
          animation: false, padding: 52, zoomRange: [0.2, 3],
          layout: graphLayout(width),
          transforms: [{ type: 'process-parallel-edges', mode: 'bundle', distance: 52 }],
          behaviors: ['drag-canvas', 'drag-element', { type: 'zoom-canvas', animation: false, onFinish: displayScale }],
        });
        graph.on('edge:click', (event) => {
          const edge = model.edges.find((item) => item.id === event.target.id);
          if (edge) return enqueue(async () => { await highlight(edge.id, true); showDetail(edge, true); });
        });
        graph.on('node:click', (event) => {
          const node = model.allPeople.find((item) => item.id === event.target.id);
          if (node) return enqueue(() => selectPerson(node));
        });
        await graph.render();
        if (destroyed) return;
        ready = true;
        await readableFit();
        enableGraphControls(true);
        status.textContent = description();
      } catch (error) {
        if (destroyed) return;
        graph?.destroy(); graph = null;
        status.textContent = '图形暂不可用，可通过下方原记录查看人物与来源。';
        element.querySelector('.diagram-records').open = true;
      }
    }
    return { element, load: () => enqueue(load), destroy() {
      if (element.classList.contains('is-fullscreen')) fullscreen(false);
      destroyed = true; themeObserver.disconnect(); resizeObserver.disconnect(); document.removeEventListener('keydown', escape);
      return pending.finally(() => graph?.destroy());
    } };
  };
})();
