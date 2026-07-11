/* app.js — Core Maths Compendium shared behaviour */

function toggleMenu(btn) {
  const m = document.getElementById('mobile-menu');
  const open = m.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
}

document.addEventListener('DOMContentLoaded', () => {

  // Subtopic accordions
  document.querySelectorAll('.sub-head').forEach(head => {
    head.addEventListener('click', () => {
      const body = head.nextElementSibling;
      const open = head.classList.toggle('open');
      body.classList.toggle('open', open);
      body.style.maxHeight = open ? body.scrollHeight + 'px' : '0';
    });
  });

  // Scroll reveal
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && items.length) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    items.forEach((el, i) => { el.style.transitionDelay = (i % 6) * 0.06 + 's'; obs.observe(el); });
  } else {
    items.forEach(el => el.classList.add('in'));
  }
});
