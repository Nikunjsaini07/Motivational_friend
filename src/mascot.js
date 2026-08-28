(() => {
  let serial = 0;
  globalThis.MF_MASCOT_SVG = function mascotSvg(mood = 'gentle') {
    const angry = mood === 'cute-angry' || mood === 'yapping';
    const asleep = mood === 'sleeping';
    const id = 'mf-fur-' + (++serial);
    const eyes = asleep
      ? '<path d="M48 68q7 6 14 0m34 0q7 6 14 0" fill="none" stroke="#393634" stroke-width="3" stroke-linecap="round"/>'
      : '<g class="mf-eyes"><ellipse cx="55" cy="66" rx="7.5" ry="10" fill="#282624"/><ellipse cx="103" cy="66" rx="7.5" ry="10" fill="#282624"/><ellipse cx="52.5" cy="62" rx="2.8" ry="3.4" fill="white"/><ellipse cx="100.5" cy="62" rx="2.8" ry="3.4" fill="white"/><circle cx="57" cy="71" r="1.3" fill="#BFBAB4"/><circle cx="105" cy="71" r="1.3" fill="#BFBAB4"/></g>';
    const brows = angry
      ? '<path d="m45 49 17 6m49-6-17 6" stroke="#706A64" stroke-width="3.5" stroke-linecap="round"/>'
      : '<path d="M47 49q7-4 14 0m35 0q7-4 14 0" fill="none" stroke="#C5BEB5" stroke-width="2" stroke-linecap="round"/>';
    const mouth = angry
      ? '<path d="M73 86q6-5 12 0" fill="none" stroke="#49423D" stroke-width="2.4" stroke-linecap="round"/>'
      : '<path d="M79 79v3m-9 0q4 7 9 0 5 7 9 0" fill="none" stroke="#49423D" stroke-width="2.2" stroke-linecap="round"/>';
    return [
      '<svg class="mf-mascot-svg" viewBox="0 0 160 146" role="img" aria-label="A small fluffy cat, ' + (asleep ? 'sleeping peacefully' : angry ? 'with a cute little pout' : 'smiling gently') + '">',
      '<defs><radialGradient id="' + id + '" cx=".4" cy=".22" r=".85"><stop stop-color="#FFFDF9"/><stop offset=".66" stop-color="#F1EEE8"/><stop offset="1" stop-color="#CEC7BE"/></radialGradient></defs>',
      '<ellipse cx="80" cy="137" rx="43" ry="5" fill="#000" opacity=".32"/>',
      '<g class="mf-cat-body">',
      '<path class="mf-tail" d="M107 117c34 11 45-14 29-22" fill="none" stroke="#DCD5CC" stroke-width="13" stroke-linecap="round"/>',
      '<path d="M51 93c-5 11-11 23-6 33 5 12 64 13 70 0 5-11-3-25-9-33Z" fill="url(#' + id + ')"/>',
      '<ellipse cx="60" cy="130" rx="15" ry="7" fill="#F4F0EA"/><ellipse cx="100" cy="130" rx="15" ry="7" fill="#F4F0EA"/>',
      '<path d="M33 55c-3-15-3-37 4-41 7-5 20 6 28 16 9-2 20-2 29 0 9-10 23-21 30-16 6 5 7 27 3 43 9 9 9 25 1 35-8 12-29 18-49 18s-43-6-51-20c-7-12-4-24 5-35Z" fill="url(#' + id + ')"/>',
      '<path d="M39 22c5 0 14 7 18 14l-20 8c-1-8-1-17 2-22Zm81 0c-5 0-14 7-18 14l20 8c1-8 1-17-2-22Z" fill="#ED857C" opacity=".7"/>',
      '<path d="M69 31l7-7 4 7 6-6 4 8" fill="#FFFDF9"/>',
      '<ellipse cx="41" cy="81" rx="10" ry="5.5" fill="#ED857C" opacity=".32"/><ellipse cx="117" cy="81" rx="10" ry="5.5" fill="#ED857C" opacity=".32"/>',
      eyes, brows,
      '<path d="M75 76q4-3 8 0-1 5-4 5t-4-5Z" fill="#ED857C"/>', mouth,
      '<path d="m31 73-7-2m8 8-8 1m103-7 8-2m-8 8 8 1" stroke="#CEC6BC" stroke-width="1.6" stroke-linecap="round"/>',
      '<path d="M55 104q24 10 48-1l-3 9q-22 9-44 0Z" fill="#ED857C"/>',
      '<path d="m93 110 9 1 2 15-11-4Z" fill="#D9776F"/>',
      '<ellipse cx="54" cy="114" rx="9" ry="11" fill="#F8F5EF" transform="rotate(-16 54 114)"/><g class="mf-tapping-paw"><ellipse cx="105" cy="114" rx="9" ry="11" fill="#F8F5EF" transform="rotate(16 105 114)"/></g>',
      '</g>',
      asleep ? '<path d="m133 36 8-1-7 8 8-1m-8-24 10-1-9 10 11-1" fill="none" stroke="#898989" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' : '',
      '</svg>'
    ].join('');
  };
})();
