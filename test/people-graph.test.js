const assert = require('node:assert/strict');
const test = require('node:test');

test('people graph keeps distinct relationship records and separates people without known links', () => {
  const { buildPeopleGraph } = require('../public/people-graph-data');
  const people = [
    { id: 'a', name: '人员甲', role: '当事人' },
    { id: 'b', name: '人员乙', role: '相关人员' },
    { id: 'c', name: '<script>人员丙</script>' },
  ];
  const relations = [
    { from: 'a', to: 'b', type: '接触', label: '首次会面', sourceRefs: [{ chunkId: 'c1' }] },
    { from: 'b', to: 'a', type: '资金', label: '款项用途待核对', sourceRefs: [{ chunkId: 'c2' }] },
    { from: 'a', to: 'missing', type: '接触', sourceRefs: [] },
  ];
  const before = JSON.stringify({ people, relations });
  const result = buildPeopleGraph(people, relations);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 2);
  assert.equal(new Set(result.edges.map((edge) => edge.id)).size, 2);
  assert.equal(result.edges[0].data.sourceRefs[0].chunkId, 'c1');
  assert.equal(result.edges[1].data.sourceRefs[0].chunkId, 'c2');
  assert.equal(result.edges[1].data.label, '款项用途待核对');
  assert.equal(result.isolated[0].data.name, '<script>人员丙</script>');
  assert.equal(result.unresolved.length, 1);
  assert.deepEqual(result.relationTypes, ['接触', '资金']);
  assert.equal(JSON.stringify({ people, relations }), before);
});

test('direct-person view respects relationship filters without relabeling filtered people as unlinked', () => {
  const { buildPeopleGraph } = require('../public/people-graph-data');
  const people = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
  const relations = [
    { from: 'a', to: 'b', type: '接触' },
    { from: 'b', to: 'c', type: '接触' },
    { from: 'a', to: 'c', type: '资金' },
  ];
  const result = buildPeopleGraph(people, relations, { relationType: '接触', focusId: 'person-0', directOnly: true });
  assert.deepEqual(result.nodes.map((node) => node.data.name), ['a', 'b']);
  assert.deepEqual(result.edges.map((edge) => edge.id), ['relation-0']);
  assert.deepEqual(result.isolated.map((node) => node.data.name), ['d']);
  assert.equal(result.allPeople.length, 4);
});
