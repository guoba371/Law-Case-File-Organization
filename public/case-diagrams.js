(function () {
  window.createCaseDiagram = function ({ caseId, view, records, relationTypes = [], onSource }) {
    const element = document.createElement('section');
    element.className = 'case-diagram';
    element.innerHTML = `
      <div class="diagram-toolbar" aria-label="图表工具">
        <label class="diagram-filter" ${view === 'people' ? '' : 'hidden'}>关系类型<select id="relationTypeFilter"><option value="">全部关系</option></select></label>
        <div class="diagram-actions">
          <button type="button" data-diagram-action="out" aria-label="缩小图表">缩小</button>
          <output class="diagram-scale" aria-live="polite">100%</output>
          <button type="button" data-diagram-action="in" aria-label="放大图表">放大</button>
          <button type="button" data-diagram-action="fit">适应宽度</button>
          <a class="btn btn-secondary diagram-download" hidden>下载 SVG</a>
        </div>
      </div>
      <p class="diagram-notice" role="status">正在绘制图表…</p>
      <div class="diagram-viewport" tabindex="0" aria-label="图表画布，可滚动查看"><div class="diagram-canvas"></div></div>
      <details class="diagram-records"><summary>查看原记录与来源</summary></details>`;
    element.querySelector('.diagram-records').append(records);
    const canvas = element.querySelector('.diagram-canvas');
    const viewport = element.querySelector('.diagram-viewport');
    const notice = element.querySelector('.diagram-notice');
    const download = element.querySelector('.diagram-download');
    const filter = element.querySelector('#relationTypeFilter');
    const zoomButtons = ['out', 'in', 'fit'].map((action) => element.querySelector(`[data-diagram-action="${action}"]`));
    relationTypes.forEach((type) => {
      const option = document.createElement('option');
      option.value = type; option.textContent = type; filter.append(option);
    });
    let generation = 0;
    let controller;
    let sources = {};
    let scale = 1;
    let svgWidth = 0;
    let svg;
    let destroyed = false;

    function zoom(next) {
      if (!svg) return;
      scale = Math.max(0.2, Math.min(3, next));
      svg.style.width = `${svgWidth * scale}px`;
      svg.style.height = 'auto';
      element.querySelector('.diagram-scale').textContent = `${Math.round(scale * 100)}%`;
    }
    function fit() { zoom(Math.min(1, Math.max(240, viewport.clientWidth - 32) / svgWidth)); }
    element.querySelector('[data-diagram-action="out"]').addEventListener('click', () => zoom(scale / 1.25));
    element.querySelector('[data-diagram-action="in"]').addEventListener('click', () => zoom(scale * 1.25));
    element.querySelector('[data-diagram-action="fit"]').addEventListener('click', fit);
    function openSource(event) {
      const target = event.target.closest('[data-diagram-ref]');
      if (target && sources[target.dataset.diagramRef]) onSource(sources[target.dataset.diagramRef]);
    }
    canvas.addEventListener('click', openSource);
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSource(event); }
    });
    async function load() {
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      const params = new URLSearchParams({ theme: document.documentElement.dataset.theme || 'light' });
      if (filter.value) params.set('relationType', filter.value);
      const url = `/api/cases/${encodeURIComponent(caseId)}/diagrams/${view}?${params}`;
      notice.textContent = '正在绘制图表…';
      download.hidden = true;
      zoomButtons.forEach((button) => { button.disabled = true; });
      canvas.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Diagram unavailable');
        const result = await response.json();
        if (destroyed || current !== generation) return;
        sources = result.sources;
        canvas.innerHTML = result.svg;
        notice.textContent = result.notice;
        svg = canvas.querySelector('svg');
        if (svg) {
          svgWidth = Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
          zoom(1);
          download.href = `${url}&format=svg`;
          download.hidden = false;
          zoomButtons.forEach((button) => { button.disabled = false; });
        }
      } catch (error) {
        if (destroyed || current !== generation || error.name === 'AbortError') return;
        canvas.innerHTML = '';
        svg = null;
        sources = {};
        notice.textContent = '图形暂不可用，可展开原记录核验来源。';
        element.querySelector('.diagram-records').open = true;
      } finally {
        if (current === generation) canvas.removeAttribute('aria-busy');
      }
    }
    filter.addEventListener('change', load);
    const themeObserver = new MutationObserver(load);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return { element, load, destroy() { destroyed = true; generation += 1; controller?.abort(); themeObserver.disconnect(); } };
  };
})();
