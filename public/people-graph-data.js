(function (root) {
  function buildPeopleGraph(people = [], relations = [], options = {}) {
    const allPeople = people.map((person, index) => ({
      id: `person-${index}`,
      data: { ...person, sourceRefs: (person.sourceRefs || []).map((ref) => ({ ...ref })) },
    }));
    const byId = new Map(allPeople.map((person) => [person.data.id, person]));
    const unresolved = [];
    const allEdges = [];
    relations.forEach((relation, index) => {
      const source = byId.get(relation.from);
      const target = byId.get(relation.to);
      if (!source || !target) { unresolved.push(relation); return; }
      allEdges.push({
        id: `relation-${index}`, source: source.id, target: target.id,
        data: { ...relation, sourceRefs: (relation.sourceRefs || []).map((ref) => ({ ...ref })) },
      });
    });
    const linked = new Set(allEdges.flatMap((edge) => [edge.source, edge.target]));
    const edges = allEdges.filter((edge) => (!options.relationType || edge.data.type === options.relationType)
      && (!options.directOnly || !options.focusId || edge.source === options.focusId || edge.target === options.focusId));
    const visible = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    if (options.directOnly && options.focusId) visible.add(options.focusId);
    return {
      nodes: allPeople.filter((person) => visible.has(person.id)), edges, allPeople,
      isolated: allPeople.filter((person) => !linked.has(person.id)), unresolved,
      relationTypes: [...new Set(allEdges.map((edge) => edge.data.type).filter(Boolean))],
    };
  }
  const api = { buildPeopleGraph };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PeopleGraphData = api;
})(typeof window === 'undefined' ? globalThis : window);
