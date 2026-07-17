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
