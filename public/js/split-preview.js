(function () {
  'use strict';

  document.querySelectorAll('.split-wrapper').forEach(function (wrapper) {
    var preview  = wrapper.querySelector('.split-preview');
    var iframe   = wrapper.querySelector('.split-preview-iframe');
    var closeBtn = wrapper.querySelector('.split-preview-close');
    var linkClass = wrapper.dataset.linkClass || 'split-link';

    if (!preview || !iframe || !closeBtn) return;

    function openPreview(url) {
      iframe.src = url;
      wrapper.classList.add('is-split');
      document.body.classList.add('has-split-preview');
    }

    function closePreview() {
      wrapper.classList.remove('is-split');
      document.body.classList.remove('has-split-preview');
      iframe.src = 'about:blank';
    }

    wrapper.querySelectorAll('a.' + linkClass).forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        openPreview(link.href);
      });
    });

    closeBtn.addEventListener('click', closePreview);
  });
}());
