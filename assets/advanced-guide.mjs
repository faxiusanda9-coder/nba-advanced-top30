import { loadExplanationCatalog } from './metric-explanations.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
};

function metricContent(metric, headingTag = 'h3') {
  const content = document.createDocumentFragment();
  const title = metric.name === metric.symbol ? metric.symbol : `${metric.symbol} · ${metric.name}`;
  content.append(node(headingTag, title));
  if (metric.full_name) content.append(node('p', metric.full_name, 'guide-full-name'));
  content.append(node('p', metric.short_description, 'guide-short-description'));
  const details = node('dl', null, 'guide-definitions');
  for (const [label, value] of [
    ['基础解释', metric.details.meaning], ['它回答什么问题', metric.details.usage],
    ['数值参考', metric.reference_direction], ['使用限制', metric.details.limitation]
  ]) {
    const block = node('div'); block.append(node('dt', label), node('dd', value)); details.append(block);
  }
  content.append(details);
  const sources = node('div', null, 'guide-sources'); sources.append(node('span', '来源：'));
  for (const source of metric.sources) {
    const link = node('a', source.label); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
  }
  content.append(sources);
  return content;
}

async function renderGuide() {
  $('guideState').hidden = false; $('guideState').textContent = '正在读取指标说明…'; $('retryGuide').hidden = true;
  try {
    const catalog = await loadExplanationCatalog();
    $('guideIntroduction').replaceChildren(node('h2', catalog.introduction.title), ...catalog.introduction.paragraphs.map(text => node('p', text)));
    const navigation = [], sections = [];
    for (const category of catalog.categories) {
      const link = node('a', category.name); link.href = `#category-${category.id}`; navigation.push(link);
      const section = node('section', null, 'profile-card guide-section'); section.id = `category-${category.id}`;
      const title = node('h2', category.name); title.id = `category-title-${category.id}`; section.setAttribute('aria-labelledby', title.id); section.append(title);
      for (const key of category.metrics) {
        const metric = catalog.metrics[key], article = node('article', null, 'metric-guide-article'); article.id = key;
        article.append(metricContent(metric));
        for (const variant of Object.values(metric.variants || {})) {
          const details = node('details', null, 'guide-model-variant'); details.append(node('summary', variant.name));
          const body = node('div'); body.append(metricContent(variant, 'h4')); details.append(body); article.append(details);
        }
        section.append(article);
      }
      sections.push(section);
    }
    $('guideCategories').replaceChildren(...navigation); $('guideSections').replaceChildren(...sections);
    const notes = node('ul'); notes.append(...catalog.reading_notes.items.map(text => node('li', text)));
    $('guideReadingNotes').replaceChildren(node('h2', catalog.reading_notes.title), notes);
    $('guideUpdatedAt').textContent = `说明核对日期：${catalog.updated_at}`;
    $('guideContent').hidden = false; $('guideState').hidden = true;
    // The anchor can arrive before the JSON has rendered its target.
    const anchor = decodeURIComponent(location.hash.slice(1));
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  } catch {
    $('guideState').textContent = '指标说明暂时无法加载，请重新尝试。'; $('retryGuide').hidden = false;
  }
}
$('retryGuide').addEventListener('click', renderGuide);
renderGuide();
