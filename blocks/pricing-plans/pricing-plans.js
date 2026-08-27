import { createOptimizedPicture } from '../../scripts/aem.js';

function parsePriceParagraph(p) {
  const strong = p.querySelector('strong');
  if (!strong) return null;
  const struck = p.querySelector('s, del');

  let suffix = '';
  let node = strong.nextSibling;
  while (node) {
    suffix += node.textContent || '';
    node = node.nextSibling;
  }

  const label = p.textContent.trim();
  let period = 'default';
  if (/^monthly/i.test(label)) period = 'monthly';
  else if (/^annual/i.test(label)) period = 'annual';

  return {
    period,
    original: struck ? struck.textContent.trim() : '',
    current: strong.textContent.trim(),
    suffix: suffix.trim(),
  };
}

function defaultPeriod(index) {
  return index === 0 ? 'annual' : 'monthly';
}

function decoratePriceCell(cell) {
  const prices = [...cell.querySelectorAll('p')]
    .map(parsePriceParagraph)
    .filter(Boolean);
  cell.replaceChildren();
  cell.classList.add('pricing-plans-price');

  return prices.map((price, i) => {
    const period = price.period === 'default' ? defaultPeriod(i) : price.period;
    const option = document.createElement('div');
    option.className = 'pricing-plans-price-option';
    option.dataset.period = period;

    if (price.original) {
      const original = document.createElement('span');
      original.className = 'pricing-plans-price-original';
      original.textContent = price.original;
      option.append(original);
    }

    const current = document.createElement('span');
    current.className = 'pricing-plans-price-current';
    current.textContent = price.current;
    option.append(current);

    if (price.suffix) {
      const suffix = document.createElement('span');
      suffix.className = 'pricing-plans-price-suffix';
      suffix.textContent = price.suffix;
      option.append(suffix);
    }

    cell.append(option);
    return period;
  });
}

function decorateHeaderCell(cell) {
  cell.classList.add('pricing-plans-header');
  cell.querySelectorAll('picture > img').forEach((img) => {
    img.closest('picture').replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '200' }]));
  });
}

function buildToggle(block, periods, activePeriod) {
  const toggle = document.createElement('div');
  toggle.className = 'pricing-plans-toggle';
  toggle.setAttribute('role', 'tablist');

  periods.forEach((period) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pricing-plans-toggle-option';
    button.textContent = period;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', period === activePeriod);
    button.classList.toggle('is-active', period === activePeriod);

    button.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach((btn) => {
        const selected = btn === button;
        btn.classList.toggle('is-active', selected);
        btn.setAttribute('aria-selected', selected);
      });
      block.querySelectorAll('.pricing-plans-price-option').forEach((option) => {
        option.hidden = option.dataset.period !== period;
      });
    });

    toggle.append(button);
  });

  return toggle;
}

export default function decorate(block) {
  const rows = [...block.children];
  const list = document.createElement('ul');
  list.className = 'pricing-plans-list';

  const periods = new Set();

  rows.forEach((row) => {
    const [headerCell, priceCell, featuresCell, ctaCell] = [...row.children];
    const li = document.createElement('li');
    li.className = 'pricing-plans-card';

    if (headerCell) {
      decorateHeaderCell(headerCell);
      li.append(headerCell);
    }
    if (priceCell) {
      decoratePriceCell(priceCell).forEach((period) => periods.add(period));
      li.append(priceCell);
    }
    if (featuresCell) {
      featuresCell.classList.add('pricing-plans-features');
      li.append(featuresCell);
    }
    if (ctaCell) {
      ctaCell.classList.add('pricing-plans-cta');
      li.append(ctaCell);
    }

    list.append(li);
  });

  block.replaceChildren(list);

  const activePeriod = periods.has('annual') ? 'annual' : [...periods][0];
  block.querySelectorAll('.pricing-plans-price-option').forEach((option) => {
    option.hidden = option.dataset.period !== activePeriod;
  });

  if (periods.size > 1) {
    block.prepend(buildToggle(block, [...periods], activePeriod));
  }
}
