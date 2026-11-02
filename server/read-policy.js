import { parse, Kind } from 'graphql';

// Phase 1 is read-only for everyone, including authenticated users.
// No flag or request parameter can enable mutations.
export function inspectReadQuery(query, automation = false) {
  if (typeof query !== 'string' || !query.trim() || query.length > 50000) throw new Error('Invalid query');
  const document = parse(query, { maxTokens: 10000 });
  const operations = document.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1 || operations[0].operation !== 'query') throw new Error('Read only');
  if (document.definitions.some(d => ![Kind.OPERATION_DEFINITION, Kind.FRAGMENT_DEFINITION].includes(d.kind))) throw new Error('Invalid definition');
  const fragments = new Map(document.definitions.filter(d => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]));
  const roots = [];
  function walk(set, visited = new Set()) {
    for (const selection of set.selections) {
      if (selection.kind === Kind.FIELD) roots.push(selection.name.value);
      else if (selection.kind === Kind.INLINE_FRAGMENT) walk(selection.selectionSet, visited);
      else {
        const name = selection.name.value;
        if (visited.has(name) || !fragments.has(name)) throw new Error('Invalid fragment');
        walk(fragments.get(name).selectionSet, new Set([...visited, name]));
      }
    }
  }
  walk(operations[0].selectionSet);
  if (automation && roots.some(name => !['shop', 'locations', 'products'].includes(name))) throw new Error('Read scope');
  return { reports: roots.includes('shopifyqlQuery') };
}
