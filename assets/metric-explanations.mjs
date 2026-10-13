const catalogUrl = '/data/advanced_metrics_explanation.json';
const supportedKeys = new Set(['BPM', 'OBPM', 'DBPM', 'VORP', 'WS_48', 'TS_PCT', 'USG_PCT', 'RAPTOR', 'LAKER', 'RAPTOR_PHASE']);
let catalogPromise;

export function validateExplanationCatalog(catalog) {
  if (catalog?.schema_version !== 1 || !Array.isArray(catalog.categories) || !catalog.introduction?.paragraphs?.length ||
      !catalog.model_family?.short_description) throw new Error('Invalid explanation catalog');
  const categorized = catalog.categories.flatMap(category => category.metrics);
  if (new Set(categorized).size !== categorized.length || categorized.length !== Object.keys(catalog.metrics || {}).length) {
    throw new Error('Invalid explanation categories');
  }
  for (const key of categorized) {
    const item = catalog.metrics[key];
    if (!item || ['name', 'symbol', 'short_description', 'category', 'reference_direction'].some(field => !item[field]) ||
        ['meaning', 'usage', 'limitation'].some(field => !item.details?.[field]) ||
        !item.sources?.length || item.sources.some(source => !source.label || !/^https:\/\//.test(source.url))) {
      throw new Error(`Invalid explanation: ${key}`);
    }
  }
  return catalog;
}

export function loadExplanationCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch(catalogUrl, { signal: AbortSignal.timeout(10_000) })
      .then(response => { if (!response.ok) throw new Error('Explanations unavailable'); return response.json(); })
      .then(validateExplanationCatalog)
      .catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

export function resolveMetricExplanation(catalog, key, sourceLabel = '') {
  const aliases = { 'WS/48': 'WS_48', 'TS%': 'TS_PCT', 'USG%': 'USG_PCT' };
  key = aliases[key] || key;
  if (key === 'RAPTOR_PHASE') {
    // Only the model label is used; player identity and statistics never enter
    // the explanation layer. Table headers cover multiple model versions.
    if (sourceLabel.includes('LAKER')) key = 'LAKER';
    else if (sourceLabel.includes('Estimated RAPTOR')) {
      return { ...catalog.metrics.RAPTOR.variants.estimated, guide_key: 'RAPTOR' };
    } else if (sourceLabel.includes('FiveThirtyEight')) key = 'RAPTOR';
    else return catalog.model_family;
  }
  return catalog.metrics[key] ? { ...catalog.metrics[key], guide_key: key } : null;
}

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};
let modal, title, description, direction, guideLink, retryButton, opener, requestId = 0;

function ensureDialog() {
  if (modal) return;
  modal = node('dialog', null, 'metric-explanation-dialog');
  modal.id = 'metricExplanationDialog'; modal.setAttribute('aria-labelledby', 'metricExplanationTitle');
  modal.setAttribute('aria-describedby', 'metricExplanationDescription');
  const heading = node('div', null, 'metric-explanation-heading');
  title = node('h2'); title.id = 'metricExplanationTitle';
  const close = node('button', '关闭', 'metric-explanation-close'); close.type = 'button';
  close.setAttribute('aria-label', '关闭指标解释'); close.addEventListener('click', () => modal.close());
  heading.append(title, close);
  description = node('p'); description.id = 'metricExplanationDescription'; description.setAttribute('role', 'status');
  direction = node('p', null, 'metric-reference-direction');
  guideLink = node('a', '查看完整说明 →', 'metric-guide-link');
  retryButton = node('button', '重试'); retryButton.type = 'button'; retryButton.hidden = true;
  modal.append(heading, description, direction, guideLink, retryButton);
  modal.addEventListener('close', () => { requestId++; if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  modal.addEventListener('click', event => {
    const rect = modal.getBoundingClientRect();
    if (event.target === modal && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) modal.close();
  });
  document.body.append(modal);
}

async function showExplanation(key, sourceLabel, button) {
  ensureDialog(); opener = button;
  const token = ++requestId;
  title.textContent = '指标解释'; description.textContent = '正在读取说明…'; direction.hidden = true; retryButton.hidden = true;
  guideLink.href = '/advanced-guide';
  if (!modal.open) modal.showModal();
  retryButton.onclick = () => showExplanation(key, sourceLabel, button);
  try {
    const catalog = await loadExplanationCatalog(), metric = resolveMetricExplanation(catalog, key, sourceLabel);
    if (!metric) throw new Error('Unknown metric');
    if (token !== requestId || !modal.open) return;
    title.textContent = metric.name; description.textContent = metric.short_description;
    direction.textContent = `参考方向：${metric.reference_direction}`; direction.hidden = false;
    guideLink.href = `/advanced-guide#${encodeURIComponent(metric.guide_key)}`;
  } catch {
    if (token !== requestId || !modal.open) return;
    description.textContent = '解释暂时无法加载，请重试。'; retryButton.hidden = false;
  }
}

export function createExplanationButton(key, label, sourceLabel = '') {
  if (!supportedKeys.has(key)) return null;
  const button = node('button', 'ⓘ', 'metric-info'); button.type = 'button'; button.dataset.explanationKey = key;
  button.setAttribute('aria-label', `查看 ${label} 指标解释`); button.setAttribute('aria-haspopup', 'dialog');
  button.addEventListener('click', event => { event.stopPropagation(); showExplanation(key, sourceLabel, button); });
  return button;
}
