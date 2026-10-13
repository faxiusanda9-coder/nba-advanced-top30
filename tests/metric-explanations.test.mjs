import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadExplanationCatalog, resolveMetricExplanation, validateExplanationCatalog } from '../assets/metric-explanations.mjs';
const catalog = JSON.parse(await readFile(new URL('../data/advanced_metrics_explanation.json', import.meta.url), 'utf8'));

test('nine requested metrics have categorized, sourced explanations without player ratings', () => {
  assert.equal(validateExplanationCatalog(catalog), catalog);
  assert.deepEqual(Object.keys(catalog.metrics).sort(), ['BPM','OBPM','DBPM','VORP','WS_48','TS_PCT','USG_PCT','RAPTOR','LAKER'].sort());
  assert.equal(catalog.categories.length, 4);
  assert(catalog.metrics.VORP.reference_direction.includes('替代水平'));
  assert(catalog.metrics.USG_PCT.details.limitation.includes('持球时间'));
  assert(!/MVP级|历史超巨|GOAT|詹姆斯|乔丹|库里/.test(JSON.stringify(catalog)));
  const missing = structuredClone(catalog); delete missing.metrics.DBPM.details.limitation;
  assert.throws(() => validateExplanationCatalog(missing));
  const badSource = structuredClone(catalog); badSource.metrics.BPM.sources[0].url = 'javascript:alert(1)';
  assert.throws(() => validateExplanationCatalog(badSource));
});

test('model explanations follow the actual source and generic table headers cover the model family', () => {
  assert.equal(resolveMetricExplanation(catalog,'RAPTOR_PHASE','Neil Paine LAKER').guide_key,'LAKER');
  assert.equal(resolveMetricExplanation(catalog,'RAPTOR_PHASE','Neil Paine Estimated RAPTOR').name,'Estimated RAPTOR');
  assert.equal(resolveMetricExplanation(catalog,'RAPTOR_PHASE','FiveThirtyEight RAPTOR · 历史箱分版').name,'RAPTOR');
  assert.equal(resolveMetricExplanation(catalog,'RAPTOR_PHASE').name,'RAPTOR / LAKER');
  assert.equal(resolveMetricExplanation(catalog,'WS/48').guide_key,'WS_48');
  assert.equal(resolveMetricExplanation(catalog,'TS%').guide_key,'TS_PCT');
  assert.equal(resolveMetricExplanation(catalog,'USG%').guide_key,'USG_PCT');
  assert.equal(resolveMetricExplanation(catalog,'unknown'),null);
});

test('shared catalog retries a failed request and shares one successful load', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    assert.equal(url,'/data/advanced_metrics_explanation.json'); calls++;
    return calls === 1 ? {ok:false} : {ok:true,json:async()=>structuredClone(catalog)};
  };
  try {
    await assert.rejects(loadExplanationCatalog());
    const [first,second] = await Promise.all([loadExplanationCatalog(),loadExplanationCatalog()]);
    assert.equal(first,second); assert.equal(calls,2);
    assert.equal(await loadExplanationCatalog(),first); assert.equal(calls,2);
  } finally { globalThis.fetch = original; }
});
