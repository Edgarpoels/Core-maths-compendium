/* app.js — Core Maths Compendium shared behaviour */

function toggleMenu(btn) {
  const m = document.getElementById('mobile-menu');
  const open = m.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
}

document.addEventListener('DOMContentLoaded', () => {

  // Nav link to the beta online course (all pages share this script)
  (function () {
    const self = document.querySelector('script[src$="app.js"]');
    const root = self ? self.getAttribute('src').replace(/app\.js$/, '') : '';
    const href = root + 'online-course.html';
    const here = /online-course\.html$/.test(location.pathname);
    document.querySelectorAll('.nav-links, #mobile-menu, .mobile-tabbar').forEach(box => {
      if (box.querySelector('a[href$="online-course.html"]')) return;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'Beta course';
      if (here) a.className = 'active';
      const contact = box.querySelector('a[href$="contact.html"]');
      box.insertBefore(a, contact || null);
    });
  })();

  // Side notice: Core Maths is moving to DNEP Education (dnep.co.uk)
  (function () {
    const KEY = 'dnep-notice-closed';
    let closed = false;
    try { closed = localStorage.getItem(KEY) === '1'; } catch (e) {}
    const box = document.createElement('aside');
    box.className = 'dnep-notice' + (closed ? ' is-closed' : '');
    box.setAttribute('aria-label', 'Core Maths is moving to DNEP Education');
    box.innerHTML =
      '<button type="button" class="dnep-tab" aria-expanded="' + (!closed) + '">Moving to DNEP.co.uk</button>' +
      '<div class="dnep-card">' +
        '<button type="button" class="dnep-close" aria-label="Minimise this notice">&times;</button>' +
        '<strong>Core Maths is moving to DNEP Education.</strong>' +
        '<p>Everything here stays free. New and updated resources, such as revised booklets, new papers and the online tracker, will be published on <b>dnep.co.uk</b>. No sign-in needed for the Core Maths resources.</p>' +
        '<a class="dnep-link" href="https://dnep.co.uk" rel="noopener">Visit dnep.co.uk &rarr;</a>' +
      '</div>';
    document.body.appendChild(box);
    const tab = box.querySelector('.dnep-tab');
    function setClosed(v) {
      box.classList.toggle('is-closed', v);
      tab.setAttribute('aria-expanded', String(!v));
      try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
    }
    tab.addEventListener('click', () => setClosed(false));
    box.querySelector('.dnep-close').addEventListener('click', () => setClosed(true));
  })();

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

  // Contact form (Web3Forms — keeps the real inbox address out of the page source)
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('contact-status');
      const btn = contactForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      status.textContent = '';
      status.className = 'form-status';
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(contactForm)))
        });
        const data = await res.json();
        if (data.success) {
          status.textContent = "Thanks — your message has been sent. I'll get back to you soon.";
          status.classList.add('ok');
          contactForm.reset();
        } else {
          throw new Error(data.message || 'Something went wrong');
        }
      } catch (err) {
        status.textContent = 'Sorry, something went wrong sending that. Please try again in a moment.';
        status.classList.add('err');
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  }
});
