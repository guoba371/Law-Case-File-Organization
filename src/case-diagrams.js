const LANES = ['案件事实', '人员行为', '资金与物品', '侦查程序', '强制措施'];
const THEMES = {
  light: { bg: '#fbfbfd', fg: '#1d1d1f', line: '#778799', accent: '#0071e3', muted: '#54545a', surface: '#f0f5fc', border: '#a1b3c8' },
  dark: { bg: '#1c1c1e', fg: '#f5f5f7', line: '#8296ae', accent: '#409cff', muted: '#b6bdc8', surface: '#252b35', border: '#657b96' },
};
const TITLES = { people: '人物关系图', timeline: '案件时间轴', events: '事件进展图' };

function xml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function dateKey(item) {
  if (item.precision === 'unknown') return null;
  const match = String(item.date || '').trim().match(/^(\d{4})(?:[-/.年](\d{1,2}))?(?:[-/.月](\d{1,2}))?/);
  return match ? `${match[1]}-${(match[2] || '00').padStart(2, '0')}-${(match[3] || '00').padStart(2, '0')}` : null;
}

function ordered(items) {
  return items.map((item, index) => ({ item, index, key: dateKey(item) }))
    .sort((a, b) => (a.key || 'z').localeCompare(b.key || 'z') || a.index - b.index);
}

async function renderCaseDiagram(views, view, options = {}) {
  if (!Object.hasOwn(TITLES, view)) throw new Error('不支持的图表类型');
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const lines = [view === 'events' ? 'flowchart LR' : 'flowchart TB'];
  const labels = [];
  const sources = {};
  const nodes = new Map();
  const edgeRefs = new Map();
  let edgeIndex = 0;
  // Parse only generated tokens; case text never becomes executable Mermaid syntax.
  function label(value) {
    const token = `LABEL${labels.length}TOKEN`;
    labels.push({ value: String(value || '') });
    return token;
  }
  function node(id, text, refs = []) {
    lines.push(`${id}["${label(text)}"]`);
    nodes.set(id, text);
    sources[id] = refs;
  }
  function edge(from, to, text, refs) {
    const key = `${from}:${to}`;
    const token = label(text);
    lines.push(`${from} ---|${token}| ${to}`);
    const ref = `relation${edgeIndex++}`;
    sources[ref] = refs || [];
    const labelKey = `${key}:${text}`;
    if (!edgeRefs.has(labelKey)) edgeRefs.set(labelKey, []);
    edgeRefs.get(labelKey).push(ref);
  }
  const notes = ['模型候选，须核验来源；不代表事实认定。'];
  if (view === 'people') {
    const people = views.people || [];
    const ids = new Map(people.map((person, index) => [person.id, `p${index}`]));
    people.forEach((person, index) => node(`p${index}`, `${person.name || '人员待确认'}\n${person.role || '身份待确认'}`, person.sourceRefs));
    let unresolved = 0;
    (views.relations || []).forEach((relation) => {
      if (options.relationType && relation.type !== options.relationType) return;
      const from = ids.get(relation.from);
      const to = ids.get(relation.to);
      if (!from || !to) { unresolved += 1; return; }
      edge(from, to, relation.label || relation.type || '关系待核对', relation.sourceRefs);
    });
    notes.push('连线表示材料记载的关系，不另行推定行为方向。');
    if (unresolved) notes.push(`${unresolved} 条关系的人员节点待核对，详见下方记录。`);
  } else if (view === 'timeline') {
    const items = ordered(views.timeline || []);
    let previous;
    items.forEach(({ item, index, key }) => {
      const id = `t${index}`;
      node(id, `${key ? item.date : '时间待确认'}\n${item.title || '未命名事件'}`, item.sourceRefs);
      if (key && previous) lines.push(`${previous} --- ${id}`);
      if (key) previous = id;
    });
    notes.push('连线仅表示时间排列，不表示因果；日期精度以原文为准，时间不详单列。');
  } else {
    LANES.forEach((lane, laneIndex) => {
      const items = ordered(views.events || []).filter(({ item }) => (LANES.includes(item.lane) ? item.lane : LANES[0]) === lane);
      if (!items.length) return;
      lines.push(`subgraph lane${laneIndex}[${label(lane)}]`);
      let previous;
      items.forEach(({ item, index, key }) => {
        const id = `e${index}`;
        node(id, `${key ? item.date : '时间待确认'}\n${item.title || '未命名事件'}`, item.sourceRefs);
        if (key && previous) lines.push(`${previous} --- ${id}`);
        if (key) previous = id;
      });
      lines.push('end');
    });
    notes.push('按案件专题分组，连线仅表示时间排列，不表示因果。');
  }
  if (!nodes.size) return { svg: '', source: '', sources: {}, title: TITLES[view], notice: '暂无数据', theme };
  const { renderMermaidSVG } = await import('beautiful-mermaid');
  const syntax = lines.join('\n');
  const wrapped = (text, width = 20) => String(text).split(/\r?\n/).map((line) => {
    const chars = [...line]; const rows = [];
    while (chars.length) rows.push(chars.splice(0, width).join(''));
    return rows.join('\n');
  }).join('\n');
  // Labels are encoded twice: the renderer decodes XML once before parsing.
  const source = syntax.replace(/LABEL(\d+)TOKEN/g, (_, index) =>
    wrapped(labels[Number(index)].value).replace(/[&<>"'\[\]{}|;\\]/g, (char) => `&amp;#${char.codePointAt(0)};`).replace(/\n/g, '<br/>'));
  let svg = renderMermaidSVG(source, { ...THEMES[theme], font: 'Microsoft YaHei', padding: 32, nodeSpacing: 36, layerSpacing: 60, componentSpacing: 40 });
  // No remote fonts, scripts, or case data leave the local service.
  svg = svg.replace(/@import\s+url\([^)]*\);/g, '');
  for (const { value } of labels) {
    for (const char of new Set(value.match(/[&<>"'\[\]{}|;\\]/g) || [])) {
      svg = svg.replaceAll(`&amp;#${char.codePointAt(0)};`, xml(char));
    }
  }
  svg = svg.replace(/<g class="node" data-id="([^"]+)"/g, (match, id) => `${match} data-diagram-ref="${id}" tabindex="0" role="button" aria-label="${xml(nodes.get(id))}，核验来源"`);
  svg = svg.replace(/<g class="edge-label" data-from="([^"]+)" data-to="([^"]+)" data-label="([^"]*)"/g, (match, from, to, text) => {
    const ref = [...edgeRefs].find(([key]) => key.startsWith(`${from}:${to}:`) && xml(wrapped(key.slice(`${from}:${to}:`.length))) === text)?.[1].shift();
    return ref ? `${match} data-diagram-ref="${ref}" tabindex="0" role="button"` : match;
  });
  svg = svg.replace('<svg ', `<svg role="group" aria-label="${TITLES[view]}" `);
  svg = svg.replace('<style>', `<title>${TITLES[view]} · 候选研判</title><desc>${xml(notes.join(' '))}</desc><style>`);
  svg = svg.replace(/  text \{/g, '  svg[data-case-diagram] text {').replace(/  svg \{/g, '  svg[data-case-diagram] {').replace('<svg ', '<svg data-case-diagram="true" ');
  return { svg, source, sources, title: TITLES[view], notice: notes.join(' '), theme };
}

module.exports = { renderCaseDiagram };
