// Paste this whole file's contents into javascript_tool (Claude Browser) as
// `text`, after editing SELECTORS for the page being audited. The final
// expression's value is returned (and JSON-serialized) by the tool — do not
// wrap it in JSON.stringify yourself.
(() => {
  const SELECTORS = [
    'body', 'h1', 'h2', 'h3', 'h4', 'p', 'a', 'button', 'nav', 'header', 'footer', 'main', '.card', 'img',
  ];

  const PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform',
    'color', 'backgroundColor', 'borderColor',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
    'borderRadius', 'maxWidth', 'width',
    'borderWidth', 'borderStyle', 'boxShadow',
  ];

  const MAX_PER_SELECTOR = 5;
  const result = {};

  for (const sel of SELECTORS) {
    const els = Array.from(document.querySelectorAll(sel)).slice(0, MAX_PER_SELECTOR);
    if (!els.length) continue;
    result[sel] = els.map((el, index) => {
      const cs = getComputedStyle(el);
      const styles = {};
      for (const prop of PROPS) styles[prop] = cs[prop];
      return {
        index,
        text: (el.textContent || '').trim().slice(0, 40),
        styles,
      };
    });
  }

  return result;
})();
